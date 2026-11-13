use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const UNIT_IN_YOCTO: u128 = 10u128.pow(21);
const PERMUTATIONS: [[usize; 3]; 6] = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
];
const KEY: &[u8; 1024] = include_bytes!("verification-key.bin");

#[near(serializers = [json])]
pub struct Proof {
    a: Vec<u8>,
    b: Vec<u8>,
    c: Vec<u8>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Award {
    provider: AccountId,
    amount: U128,
}

#[near(serializers = [json])]
pub struct MarketView {
    market: U128,
    committed: [bool; 3],
    awards: Option<[Award; 3]>,
    expired: bool,
    credit: [U128; 4],
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Market {
    buyer: AccountId,
    providers: [AccountId; 3],
    market: u128,
    deadline_ms: u64,
    budget: u128,
    commitments: [Option<[u8; 32]>; 3],
    awards: Option<[Award; 3]>,
    expired: bool,
    // Provider slots 0–2 and buyer slot 3. Each slot is assigned once.
    credit: [u128; 4],
}

#[near]
impl Market {
    #[init]
    #[payable]
    pub fn open(providers: [AccountId; 3], deadline_ms: u64) -> Self {
        let buyer = env::predecessor_account_id();
        assert_ne!(
            buyer,
            env::current_account_id(),
            "Buyer must fund a separate contract account"
        );
        assert!(
            providers
                .iter()
                .all(|provider| provider != &buyer && provider != &env::current_account_id()),
            "Buyer and contract cannot bid"
        );
        assert!(
            providers[0] != providers[1]
                && providers[1] != providers[2]
                && providers[0] != providers[2],
            "Providers must differ"
        );
        assert!(
            deadline_ms > env::block_timestamp_ms(),
            "Deadline must be in the future"
        );
        let budget = env::attached_deposit().as_yoctonear();
        assert!(
            budget >= 3 * UNIT_IN_YOCTO,
            "Fund at least three quote units"
        );
        let hash = env::sha256_array(env::current_account_id().as_bytes());
        let market = u128::from_le_bytes(hash[..16].try_into().unwrap());
        Self {
            buyer,
            providers,
            market,
            deadline_ms,
            budget,
            commitments: [None; 3],
            awards: None,
            expired: false,
            credit: [0; 4],
        }
    }

    pub fn commit(&mut self, commitment: [u8; 32]) {
        self.require_open();
        let provider = self.caller_slot();
        assert!(provider < 3, "Only providers can commit");
        assert!(
            self.commitments[provider].is_none(),
            "Commitment is immutable"
        );
        self.commitments[provider] = Some(commitment);
    }

    pub fn settle(&mut self, assignment: u8, payouts: [u32; 3], proof: Proof) -> [Award; 3] {
        self.require_open();
        let providers = PERMUTATIONS
            .get(usize::from(assignment))
            .expect("Invalid assignment");
        assert!(
            payouts
                .iter()
                .all(|&payout| (1..(1 << 24)).contains(&payout)),
            "Invalid payout"
        );
        let amounts = payouts.map(|payout| u128::from(payout) * UNIT_IN_YOCTO);
        let total: u128 = amounts.iter().sum();
        assert!(total <= self.budget, "Award exceeds escrow");

        let [a, b, c] = self
            .commitments
            .map(|commitment| commitment.expect("Missing commitment"));
        let signals = [
            scalar(self.market),
            a,
            b,
            c,
            scalar(u128::from(assignment)),
            scalar(u128::from(payouts[0])),
            scalar(u128::from(payouts[1])),
            scalar(u128::from(payouts[2])),
        ];
        assert!(verify(&signals, &proof), "Invalid proof");

        let awards = std::array::from_fn(|job| {
            let provider = providers[job];
            self.credit[provider] = amounts[job];
            Award {
                provider: self.providers[provider].clone(),
                amount: U128(amounts[job]),
            }
        });
        self.credit[3] = self.budget - total;
        self.awards = Some(awards.clone());
        awards
    }

    pub fn expire(&mut self) {
        assert!(self.awards.is_none() && !self.expired, "Already closed");
        assert!(
            env::block_timestamp_ms() >= self.deadline_ms,
            "Market still open"
        );
        self.expired = true;
        self.credit[3] = self.budget;
    }

    pub fn withdraw(&mut self) -> Promise {
        let slot = self.caller_slot();
        let amount = std::mem::take(&mut self.credit[slot]);
        assert!(amount > 0, "No credit to withdraw");
        Promise::new(env::predecessor_account_id())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(8))
                    .finish_withdraw(slot as u8, U128(amount)),
            )
    }

    #[private]
    pub fn finish_withdraw(
        &mut self,
        slot: u8,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_err() {
            self.credit[usize::from(slot)] = amount.0;
        }
        result.is_ok()
    }

    pub fn status(&self) -> MarketView {
        MarketView {
            market: U128(self.market),
            committed: self.commitments.map(|commitment| commitment.is_some()),
            awards: self.awards.clone(),
            expired: self.expired,
            credit: self.credit.map(U128),
        }
    }

    fn require_open(&self) {
        assert!(self.awards.is_none() && !self.expired, "Already closed");
        assert!(
            env::block_timestamp_ms() < self.deadline_ms,
            "Market deadline passed"
        );
    }

    fn caller_slot(&self) -> usize {
        let caller = env::predecessor_account_id();
        if caller == self.buyer {
            return 3;
        }
        self.providers
            .iter()
            .position(|provider| provider == &caller)
            .expect("Unregistered account")
    }
}

fn scalar(value: u128) -> [u8; 32] {
    let mut bytes = [0; 32];
    bytes[..16].copy_from_slice(&value.to_le_bytes());
    bytes
}

fn verify(signals: &[[u8; 32]; 8], proof: &Proof) -> bool {
    if proof.a.len() != 64 || proof.b.len() != 128 || proof.c.len() != 64 {
        return false;
    }
    if [&proof.a, &proof.b, &proof.c]
        .iter()
        .any(|point| point.iter().all(|byte| *byte == 0))
    {
        return false;
    }
    let alpha = &KEY[..64];
    let beta = &KEY[64..192];
    let gamma = &KEY[192..320];
    let delta = &KEY[320..448];
    let ic = &KEY[448..];

    let mut terms = Vec::with_capacity(9 * 96);
    terms.extend_from_slice(&ic[..64]);
    terms.extend_from_slice(&scalar(1));
    for (point, signal) in ic[64..].chunks_exact(64).zip(signals) {
        terms.extend_from_slice(point);
        terms.extend_from_slice(signal);
    }
    let vk_x = env::alt_bn128_g1_multiexp(terms);
    let neg_a = env::alt_bn128_g1_sum([&[1], proof.a.as_slice()].concat());
    env::alt_bn128_pairing_check(
        [
            neg_a.as_slice(),
            &proof.b,
            alpha,
            beta,
            &vk_x,
            gamma,
            &proof.c,
            delta,
        ]
        .concat(),
    )
}
