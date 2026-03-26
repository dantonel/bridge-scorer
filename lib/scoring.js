// Bridge scoring logic — shared between frontend and backend

export function calculateScore(level, strain, double, declarer, tricksTaken, boardNumber) {
  // Calculate bridge score based on contract and result
  const contract = parseInt(level);
  const tricksNeeded = 6 + contract;
  const tricksDiff = tricksTaken - tricksNeeded;

  // Determine vulnerability based on board number (pattern repeats every 16 boards)
  // Official duplicate bridge vulnerability pattern:
  const boardMod16 = ((boardNumber - 1) % 16) + 1; // Convert to 1-16 range
  let vulnPattern;

  if ([1, 8, 11, 14].includes(boardMod16)) {
    vulnPattern = 'none';
  } else if ([2, 5, 12, 15].includes(boardMod16)) {
    vulnPattern = 'ns';
  } else if ([3, 6, 9, 16].includes(boardMod16)) {
    vulnPattern = 'ew';
  } else if ([4, 7, 10, 13].includes(boardMod16)) {
    vulnPattern = 'both';
  }

  // Determine if declarer's side is vulnerable
  const declarerIsNS = (declarer === 'north' || declarer === 'south');
  const vulnerable = (vulnPattern === 'both') ||
                    (vulnPattern === 'ns' && declarerIsNS) ||
                    (vulnPattern === 'ew' && !declarerIsNS);

  if (tricksDiff < 0) {
    // Contract failed (went down)
    const undertricks = Math.abs(tricksDiff);
    let penalty = 0;

    if (double === '') {
      penalty = vulnerable ? undertricks * 100 : undertricks * 50;
    } else if (double === 'X') {
      // Doubled undertricks
      if (vulnerable) {
        penalty = undertricks === 1 ? 200 : 200 + (undertricks - 1) * 300;
      } else {
        penalty = undertricks === 1 ? 100 : undertricks === 2 ? 300 : 300 + (undertricks - 2) * 300;
      }
    } else if (double === 'XX') {
      // Redoubled undertricks
      if (vulnerable) {
        penalty = undertricks === 1 ? 400 : 400 + (undertricks - 1) * 600;
      } else {
        penalty = undertricks === 1 ? 200 : undertricks === 2 ? 600 : 600 + (undertricks - 2) * 600;
      }
    }

    // Return negative for declarer, positive for defenders
    // From NS perspective: if NS declared and went down, they get negative
    // If EW declared and went down, NS gets positive (defenders' score)
    return declarerIsNS ? -penalty : penalty;
  } else {
    // Contract made
    let score = 0;

    // Base trick score
    let baseScore = 0;
    if (strain === 'NT') {
      baseScore = 40 + (contract - 1) * 30;
    } else if (strain === 'H' || strain === 'S') {
      baseScore = contract * 30;
    } else {
      baseScore = contract * 20;
    }

    if (double === 'X') baseScore *= 2;
    if (double === 'XX') baseScore *= 4;

    score += baseScore;

    // Game bonus
    if (baseScore >= 100) {
      score += vulnerable ? 500 : 300;
    } else {
      score += 50;
    }

    // Slam bonus
    if (contract === 6) {
      score += vulnerable ? 750 : 500;
    } else if (contract === 7) {
      score += vulnerable ? 1500 : 1000;
    }

    // Double/redouble bonus
    if (double === 'X') score += 50;
    if (double === 'XX') score += 100;

    // Overtrick bonus
    if (tricksDiff > 0) {
      let overtrickValue = 0;
      if (double === '') {
        overtrickValue = (strain === 'H' || strain === 'S' || strain === 'NT') ? 30 : 20;
      } else if (double === 'X') {
        overtrickValue = vulnerable ? 200 : 100;
      } else if (double === 'XX') {
        overtrickValue = vulnerable ? 400 : 200;
      }
      score += tricksDiff * overtrickValue;
    }

    // Return positive for declarer's side, negative for opponents
    // From NS perspective: if NS made contract, they get positive
    // If EW made contract, NS gets negative (opponents' score)
    return declarerIsNS ? score : -score;
  }
}

export function calculateIMPs(scoreDiff) {
  const impTable = [
    [20, 0], [50, 1], [90, 2], [130, 3], [170, 4],
    [220, 5], [270, 6], [320, 7], [370, 8], [430, 9],
    [500, 10], [600, 11], [750, 12], [900, 13], [1100, 14],
    [1300, 15], [1500, 16], [1750, 17], [2000, 18], [2250, 19],
    [2500, 20], [3000, 21], [3500, 22], [4000, 23], [Infinity, 24]
  ];

  const absDiff = Math.abs(scoreDiff);
  for (let [threshold, imps] of impTable) {
    if (absDiff < threshold) {
      return scoreDiff >= 0 ? imps : -imps;
    }
  }
  return 0;
}

export function calculateVPs(impDifference) {
  // Official WBF Continuous VP Scale for 4-board matches
  // Source: https://www.worldbridge.org/wp-content/uploads/2022/12/WBF_VPScales.pdf

  const absIMPs = Math.abs(impDifference);

  // WBF VP table for 4 boards (caps at 30 IMPs = 20.00 VPs)
  const vpTable = [
    [0, 10.00], [1, 10.61], [2, 11.20], [3, 11.76], [4, 12.29],
    [5, 12.80], [6, 13.28], [7, 13.74], [8, 14.18], [9, 14.60],
    [10, 15.00], [11, 15.38], [12, 15.74], [13, 16.09], [14, 16.42],
    [15, 16.73], [16, 17.03], [17, 17.31], [18, 17.59], [19, 17.84],
    [20, 18.09], [21, 18.33], [22, 18.55], [23, 18.76], [24, 18.97],
    [25, 19.16], [26, 19.34], [27, 19.52], [28, 19.69], [29, 19.85],
    [30, 20.00]
  ];

  // Cap at 30 IMPs
  const cappedIMPs = Math.min(absIMPs, 30);

  // Find exact match in table
  const winnerVPs = vpTable[cappedIMPs][1];
  const loserVPs = 20 - winnerVPs;

  if (impDifference > 0) {
    return {
      team1VPs: winnerVPs,
      team2VPs: parseFloat(loserVPs.toFixed(2))
    };
  } else if (impDifference < 0) {
    return {
      team1VPs: parseFloat(loserVPs.toFixed(2)),
      team2VPs: winnerVPs
    };
  } else {
    return { team1VPs: 10.00, team2VPs: 10.00 };
  }
}
