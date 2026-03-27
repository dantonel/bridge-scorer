import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, calculateIMPs, calculateVPs } from '../lib/scoring.js';

describe('calculateScore', () => {
  describe('partial contracts (undoubled)', () => {
    test('1NT made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 40, partial bonus: +50
      assert.equal(calculateScore(1, 'NT', '', 'north', 7, 1), 90);
    });

    test('2H made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 2*30 = 60, partial bonus: +50
      assert.equal(calculateScore(2, 'H', '', 'north', 8, 1), 110);
    });

    test('3C made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 3*20 = 60, partial bonus: +50
      assert.equal(calculateScore(3, 'C', '', 'north', 9, 1), 110);
    });

    test('3C+1 by NS, board 1 (not vulnerable)', () => {
      // baseScore: 60, partial bonus: +50, overtrick (minor): +20
      assert.equal(calculateScore(3, 'C', '', 'north', 10, 1), 130);
    });
  });

  describe('game contracts (undoubled)', () => {
    test('3NT made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 40 + 2*30 = 100, game bonus NV: +300
      assert.equal(calculateScore(3, 'NT', '', 'north', 9, 1), 400);
    });

    test('3NT made exactly by NS, board 2 (NS vulnerable)', () => {
      // baseScore: 100, game bonus vul: +500
      assert.equal(calculateScore(3, 'NT', '', 'north', 9, 2), 600);
    });

    test('3NT+1 by NS, board 1 (not vulnerable)', () => {
      // baseScore: 100, game bonus NV: +300, overtrick (NT): +30
      assert.equal(calculateScore(3, 'NT', '', 'north', 10, 1), 430);
    });

    test('4S made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 4*30 = 120, game bonus NV: +300
      assert.equal(calculateScore(4, 'S', '', 'north', 10, 1), 420);
    });

    test('4S made exactly by EW, board 1 (not vulnerable)', () => {
      // EW declares and makes: NS perspective is negative
      assert.equal(calculateScore(4, 'S', '', 'east', 10, 1), -420);
    });

    test('5D made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 5*20 = 100, game bonus NV: +300
      assert.equal(calculateScore(5, 'D', '', 'north', 11, 1), 400);
    });
  });

  describe('slam contracts', () => {
    test('6NT by NS, board 4 (both vulnerable)', () => {
      // baseScore: 40 + 5*30 = 190, game bonus vul: +500, small slam vul: +750
      assert.equal(calculateScore(6, 'NT', '', 'north', 12, 4), 1440);
    });

    test('6NT by NS, board 1 (not vulnerable)', () => {
      // baseScore: 190, game bonus NV: +300, small slam NV: +500
      assert.equal(calculateScore(6, 'NT', '', 'north', 12, 1), 990);
    });

    test('7NT by NS, board 4 (both vulnerable)', () => {
      // baseScore: 40 + 6*30 = 220, game bonus vul: +500, grand slam vul: +1500
      assert.equal(calculateScore(7, 'NT', '', 'north', 13, 4), 2220);
    });

    test('7NT by NS, board 1 (not vulnerable)', () => {
      // baseScore: 220, game bonus NV: +300, grand slam NV: +1000
      assert.equal(calculateScore(7, 'NT', '', 'north', 13, 1), 1520);
    });

    test('6S by EW, board 4 (both vulnerable)', () => {
      // EW declares: NS gets negative
      // baseScore: 6*30 = 180, game bonus vul: +500, small slam vul: +750
      assert.equal(calculateScore(6, 'S', '', 'east', 12, 4), -1430);
    });
  });

  describe('doubled and redoubled contracts (made)', () => {
    test('2H doubled made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 2*30*2 = 120, game bonus NV: +300, double bonus: +50
      assert.equal(calculateScore(2, 'H', 'X', 'north', 8, 1), 470);
    });

    test('2H redoubled made exactly by NS, board 1 (not vulnerable)', () => {
      // baseScore: 2*30*4 = 240, game bonus NV: +300, redouble bonus: +100
      assert.equal(calculateScore(2, 'H', 'XX', 'north', 8, 1), 640);
    });
  });

  describe('failed contracts (undertricks)', () => {
    test('1NT down 1 by NS, board 1 (not vulnerable)', () => {
      // Undoubled, NV: 50. NS declares, negative.
      assert.equal(calculateScore(1, 'NT', '', 'north', 6, 1), -50);
    });

    test('1NT down 1 by NS, board 2 (NS vulnerable)', () => {
      // Undoubled, vul: 100. NS declares, negative.
      assert.equal(calculateScore(1, 'NT', '', 'north', 6, 2), -100);
    });

    test('1NT down 2 by NS, board 1 (not vulnerable)', () => {
      // Undoubled, NV: 2*50 = 100.
      assert.equal(calculateScore(1, 'NT', '', 'north', 5, 1), -100);
    });

    test('1NT down 1 doubled by NS, board 1 (not vulnerable)', () => {
      // Doubled NV, 1 trick: 100.
      assert.equal(calculateScore(1, 'NT', 'X', 'north', 6, 1), -100);
    });

    test('1NT down 2 doubled by NS, board 1 (not vulnerable)', () => {
      // Doubled NV, 2 tricks: 300.
      assert.equal(calculateScore(1, 'NT', 'X', 'north', 5, 1), -300);
    });

    test('1NT down 3 doubled by NS, board 1 (not vulnerable)', () => {
      // Doubled NV, 3 tricks: 300 + 300 = 500. (300 + (3-2)*300)
      assert.equal(calculateScore(1, 'NT', 'X', 'north', 4, 1), -500);
    });

    test('1NT down 1 doubled by NS, board 2 (NS vulnerable)', () => {
      // Doubled vul, 1 trick: 200.
      assert.equal(calculateScore(1, 'NT', 'X', 'north', 6, 2), -200);
    });

    test('1NT down 2 doubled by NS, board 2 (NS vulnerable)', () => {
      // Doubled vul, 2 tricks: 200 + 300 = 500.
      assert.equal(calculateScore(1, 'NT', 'X', 'north', 5, 2), -500);
    });

    test('1NT down 1 redoubled by NS, board 1 (not vulnerable)', () => {
      // Redoubled NV, 1 trick: 200.
      assert.equal(calculateScore(1, 'NT', 'XX', 'north', 6, 1), -200);
    });

    test('1NT down 1 redoubled by NS, board 2 (NS vulnerable)', () => {
      // Redoubled vul, 1 trick: 400.
      assert.equal(calculateScore(1, 'NT', 'XX', 'north', 6, 2), -400);
    });

    test('1NT down 1 by EW, board 1 (not vulnerable)', () => {
      // EW declares and goes down: NS perspective positive (defenders win).
      assert.equal(calculateScore(1, 'NT', '', 'east', 6, 1), 50);
    });
  });

  describe('vulnerability patterns from board number', () => {
    test('board 1 is none vulnerable', () => {
      // NV: 3NT scores 400 (not 600)
      assert.equal(calculateScore(3, 'NT', '', 'north', 9, 1), 400);
    });

    test('board 2 is NS vulnerable', () => {
      assert.equal(calculateScore(3, 'NT', '', 'north', 9, 2), 600);
    });

    test('board 3 is EW vulnerable', () => {
      // EW vul: 3NT by east scores -600 from NS perspective
      assert.equal(calculateScore(3, 'NT', '', 'east', 9, 3), -600);
    });

    test('board 4 is both vulnerable', () => {
      assert.equal(calculateScore(3, 'NT', '', 'north', 9, 4), 600);
    });

    test('board 18 has the same vulnerability as board 2 (repeats every 16)', () => {
      // (18-1) % 16 + 1 = 2 → NS vulnerable
      assert.equal(calculateScore(3, 'NT', '', 'north', 9, 18), 600);
    });

    test('board 17 has the same vulnerability as board 1', () => {
      assert.equal(calculateScore(3, 'NT', '', 'north', 9, 17), 400);
    });
  });
});

describe('calculateIMPs', () => {
  test('0 score difference is 0 IMPs', () => {
    assert.equal(calculateIMPs(0), 0);
  });

  test('positive differences map to correct IMP thresholds', () => {
    assert.equal(calculateIMPs(10), 0);   // < 20 → 0
    assert.equal(calculateIMPs(20), 1);   // 20 ≤ x < 50 → 1
    assert.equal(calculateIMPs(49), 1);
    assert.equal(calculateIMPs(50), 2);   // 50 ≤ x < 90 → 2
    assert.equal(calculateIMPs(89), 2);
    assert.equal(calculateIMPs(90), 3);   // 90 ≤ x < 130 → 3
    assert.equal(calculateIMPs(420), 9);   // 370 ≤ x < 430 → 9 (typical game)
    assert.equal(calculateIMPs(499), 10); // 430 ≤ x < 500 → 10
    assert.equal(calculateIMPs(500), 11); // 500 ≤ x < 600 → 11
  });

  test('negative differences return negative IMPs', () => {
    assert.equal(calculateIMPs(-50), -2);
    assert.equal(calculateIMPs(-420), -9);
    assert.equal(calculateIMPs(-600), -12);
  });

  test('large differences cap at 24 IMPs', () => {
    assert.equal(calculateIMPs(4000), 24);
    assert.equal(calculateIMPs(7650), 24);
    assert.equal(calculateIMPs(-4000), -24);
  });

  test('common game score differences map to expected IMPs', () => {
    // 3NT NV (400) vs 3NT NV (-400) = 800 point swing → 13 IMPs
    assert.equal(calculateIMPs(800), 13);
    // 1100 ≤ x < 1300 → 15 IMPs
    assert.equal(calculateIMPs(1200), 15);
  });
});

describe('calculateVPs', () => {
  test('0 IMP difference gives 10/10', () => {
    assert.deepEqual(calculateVPs(0), { team1VPs: 10.00, team2VPs: 10.00 });
  });

  test('positive IMP difference gives team1 more VPs', () => {
    const result = calculateVPs(10);
    assert.equal(result.team1VPs, 15.00);
    assert.equal(result.team2VPs, 5.00);
  });

  test('negative IMP difference gives team2 more VPs', () => {
    const result = calculateVPs(-10);
    assert.equal(result.team1VPs, 5.00);
    assert.equal(result.team2VPs, 15.00);
  });

  test('30 IMPs difference is the maximum (20/0)', () => {
    assert.deepEqual(calculateVPs(30), { team1VPs: 20.00, team2VPs: 0.00 });
  });

  test('IMPs beyond 30 are capped at 20/0', () => {
    assert.deepEqual(calculateVPs(50), { team1VPs: 20.00, team2VPs: 0.00 });
    assert.deepEqual(calculateVPs(-50), { team1VPs: 0.00, team2VPs: 20.00 });
  });

  test('VP values always sum to 20', () => {
    for (const imps of [1, 5, 15, 25, 30]) {
      const { team1VPs, team2VPs } = calculateVPs(imps);
      assert.equal(
        parseFloat((team1VPs + team2VPs).toFixed(2)),
        20.00,
        `VPs should sum to 20 for ${imps} IMPs`
      );
    }
  });
});
