import axios from 'axios';

// Sleeper's public matchup `points` leave an applied auto-sub on the bench.
// The original starter stays in `starters` at 0, and the sub's points stay in
// `players_points`. The official total adds those points and counts them for
// the sub. Pairings come from the unauthenticated GraphQL field
// matchup_legs_raw.subs, which lists every designated pairing, including ones
// Sleeper does not apply because the starter played.

const PLAYED_STAT_KEYS = ['gp', 'off_snp', 'st_snp', 'pts_half_ppr', 'pts_std', 'pts_ppr'];

export function roundPoints(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.round(numeric * 100) / 100;
}

// A missing stat line means the player did not take a snap that week.
// A row with games or snaps means they were active, so a designated sub stays on the bench.
export function starterDidNotPlay(stat) {
    if (!stat) {
        return true;
    }
    return !PLAYED_STAT_KEYS.some((key) => Number(stat[key]) > 0);
}

function pointsFor(matchup, playerId) {
    const playersPoints = matchup.players_points || {};
    if (playersPoints[playerId] == null) {
        return 0;
    }
    return roundPoints(playersPoints[playerId]);
}

/**
 * Apply designated auto-subs that Sleeper actually scored.
 * Returns the corrected team total and the lineup row each sub's points belong to.
 */
export function applyAutoSubs(matchup, subs, statsByPlayer = {}) {
    const starters = (matchup?.starters || []).map((playerId) => String(playerId));
    const starterSet = new Set(starters);
    const usedSubs = new Set();
    const apiPoints = roundPoints(matchup?.points || 0);
    const lineup = starters.map((playerId, slot) => ({
        slot,
        playerId,
        points: pointsFor(matchup, playerId),
        subbedFor: null
    }));
    const appliedSubs = [];
    let added = 0;

    Object.entries(subs || {}).forEach(([starterId, subId]) => {
        const starterKey = String(starterId);
        const subKey = String(subId);
        if (!subKey || subKey === '0' || usedSubs.has(subKey)) {
            return;
        }
        // Already reflected in the public starters list, or the starter was benched.
        if (!starterSet.has(starterKey) || starterSet.has(subKey)) {
            return;
        }
        if (pointsFor(matchup, starterKey) !== 0) {
            return;
        }
        if (!starterDidNotPlay(statsByPlayer?.[starterKey])) {
            return;
        }

        const subPoints = pointsFor(matchup, subKey);
        const row = lineup.find((entry) => entry.playerId === starterKey && !entry.subbedFor);
        if (row) {
            row.playerId = subKey;
            row.points = subPoints;
            row.subbedFor = starterKey;
        }
        appliedSubs.push({
            starterId: starterKey,
            subId: subKey,
            points: subPoints
        });
        usedSubs.add(subKey);
        added += subPoints;
    });

    return {
        apiPoints,
        points: roundPoints(apiPoints + added),
        lineup,
        appliedSubs
    };
}

export function matchupNeedsPlayedCheck(matchup, subs) {
    const starters = new Set((matchup?.starters || []).map((playerId) => String(playerId)));
    const playersPoints = matchup?.players_points || {};
    return Object.entries(subs || {}).some(([starterId, subId]) => {
        const starterKey = String(starterId);
        const subKey = String(subId);
        if (!subKey || subKey === '0') {
            return false;
        }
        if (!starters.has(starterKey) || starters.has(subKey)) {
            return false;
        }
        const starterPoints = Number(playersPoints[starterKey]) || 0;
        const subPoints = Number(playersPoints[subKey]) || 0;
        return starterPoints === 0 && subPoints !== 0;
    });
}

export function weekNeedsPlayedCheck(matchups, subsByRoster) {
    return (matchups || []).some((matchup) => {
        const rosterSubs = subsByRoster?.[String(matchup.roster_id)];
        return matchupNeedsPlayedCheck(matchup, rosterSubs);
    });
}

// Unauthenticated. matchup_legs is rejected without a login; matchup_legs_raw is not.
export async function fetchAutoSubsByWeek(leagueId, weeks) {
    const safeLeagueId = String(leagueId);
    const safeWeeks = (weeks || []).map((week) => Number(week)).filter((week) => Number.isInteger(week) && week > 0);
    if (!/^\d+$/.test(safeLeagueId) || safeWeeks.length === 0) {
        return {};
    }

    const selections = safeWeeks
        .map((week) => `w${week}: matchup_legs_raw(league_id: "${safeLeagueId}", round: ${week}) { roster_id subs }`)
        .join('\n');
    const response = await axios.post(
        'https://api.sleeper.app/graphql',
        { query: `query { ${selections} }` },
        { timeout: 8000 }
    );
    const data = response.data?.data || {};
    const byWeek = {};
    safeWeeks.forEach((week) => {
        const byRoster = {};
        (data[`w${week}`] || []).forEach((leg) => {
            if (leg?.subs && leg.roster_id != null) {
                byRoster[String(leg.roster_id)] = leg.subs;
            }
        });
        byWeek[week] = byRoster;
    });
    return byWeek;
}

export async function fetchPlayerNames(playerIds) {
    const names = {};
    await Promise.all([...playerIds].map(async (playerId) => {
        const id = String(playerId);
        if (!/^\d+$/.test(id)) {
            names[id] = id;
            return;
        }
        try {
            const response = await axios.get(`https://api.sleeper.app/v1/players/nfl/${id}`, { timeout: 4000 });
            const player = response.data || {};
            names[id] = `${player.first_name || ''} ${player.last_name || ''}`.trim() || id;
        } catch {
            names[id] = id;
        }
    }));
    return names;
}
