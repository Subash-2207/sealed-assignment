pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template SealedAssignment() {
    signal input market;
    signal input commitments[3];
    signal input assignment;
    signal input payouts[3];
    signal input quotes[3][3];
    signal input salts[3];

    // Columns are jobs. Rows are registered providers.
    // Order defines the public tie-break rule.
    var permutations[6][3] = [
        [0, 1, 2], [0, 2, 1], [1, 0, 2],
        [1, 2, 0], [2, 0, 1], [2, 1, 0]
    ];

    component commitment[3];
    component bounded[3][3];
    component positive[3][3];
    for (var provider = 0; provider < 3; provider++) {
        commitment[provider] = Poseidon(6);
        commitment[provider].inputs[0] <== market;
        commitment[provider].inputs[1] <== provider;
        for (var job = 0; job < 3; job++) {
            bounded[provider][job] = Num2Bits(24);
            bounded[provider][job].in <== quotes[provider][job];
            positive[provider][job] = IsZero();
            positive[provider][job].in <== quotes[provider][job];
            positive[provider][job].out === 0;
            commitment[provider].inputs[job + 2] <== quotes[provider][job];
        }
        commitment[provider].inputs[5] <== salts[provider];
        commitment[provider].out === commitments[provider];
    }

    signal total <== payouts[0] + payouts[1] + payouts[2];
    component select[6];
    component precedes[6];
    component optimal[6];
    var selectedCount = 0;
    for (var candidate = 0; candidate < 6; candidate++) {
        select[candidate] = IsEqual();
        select[candidate].in[0] <== assignment;
        select[candidate].in[1] <== candidate;
        selectedCount += select[candidate].out;
        for (var job = 0; job < 3; job++) {
            select[candidate].out * (payouts[job] - quotes[permutations[candidate][job]][job]) === 0;
        }
    }
    selectedCount === 1;

    for (var candidate = 0; candidate < 6; candidate++) {
        precedes[candidate] = LessThan(3);
        precedes[candidate].in[0] <== candidate;
        precedes[candidate].in[1] <== assignment;

        // Compare with strict inequality for earlier candidates, and <= otherwise.
        // Three 24-bit quotes sum to less than 2^26.
        optimal[candidate] = LessThan(26);
        optimal[candidate].in[0] <== total + precedes[candidate].out;
        optimal[candidate].in[1] <== 1 + quotes[permutations[candidate][0]][0]
            + quotes[permutations[candidate][1]][1] + quotes[permutations[candidate][2]][2];
        optimal[candidate].out === 1;
    }
}

component main {public [market, commitments, assignment, payouts]} = SealedAssignment();
