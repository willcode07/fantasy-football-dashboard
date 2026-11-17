import { applyAutoSubs } from '../autoSubs';

// The League 1377319553851228160, roster 6 (Kupp Half Full), 2026 Week 10.
// Public matchup points are 106.66. Sleeper shows 113.86 because Austin Ekeler
// (7.20) replaced David Montgomery, who was Out and did not play.
const kuppWeek10 = {
    roster_id: 6,
    points: 106.66,
    starters: ['4984', '5967', '5892', '8144', '8148', '1479', '10859', '4177', '3294'],
    starters_points: [22.34, 19.9, 0, 4.5, 7, 8.6, 2.6, 7.3, 34.42],
    players_points: {
        '4984': 22.34,
        '5967': 19.9,
        '5892': 0,
        '8144': 4.5,
        '8148': 7,
        '1479': 8.6,
        '10859': 2.6,
        '4177': 7.3,
        '3294': 34.42,
        '4663': 7.2
    }
};

describe('applyAutoSubs', () => {
    it('adds Ekeler’s 7.20 to Kupp Half Full’s Week 10 total and attributes the points to Ekeler', () => {
        const result = applyAutoSubs(kuppWeek10, { '5892': '4663' }, {});

        expect(result.apiPoints).toBe(106.66);
        expect(result.points).toBe(113.86);
        expect(result.appliedSubs).toEqual([
            { starterId: '5892', subId: '4663', points: 7.2 }
        ]);

        const rbSlot = result.lineup[2];
        expect(rbSlot.playerId).toBe('4663');
        expect(rbSlot.points).toBe(7.2);
        expect(rbSlot.subbedFor).toBe('5892');
    });

    it('leaves a designated sub on the bench when the starter played', () => {
        // Dynasty Week 4, The Vurgins: Kenyon Sadiq scored 0 but played 22 snaps.
        const matchup = {
            roster_id: 1,
            points: 157.62,
            starters: ['13330'],
            players_points: {
                '13330': 0,
                '5892': 4.3
            }
        };

        const result = applyAutoSubs(matchup, { '13330': '5892' }, {
            '13330': { gp: 1, off_snp: 22 }
        });

        expect(result.points).toBe(157.62);
        expect(result.appliedSubs).toEqual([]);
        expect(result.lineup[0].playerId).toBe('13330');
    });

    it('does not add a sub whose starter already scored', () => {
        const matchup = {
            roster_id: 1,
            points: 130.22,
            starters: ['11632'],
            players_points: {
                '11632': 9.9,
                '13317': 5.1
            }
        };

        const result = applyAutoSubs(matchup, { '11632': '13317' }, {});

        expect(result.points).toBe(130.22);
        expect(result.appliedSubs).toEqual([]);
    });

    it('does not add a sub who is already in the starters list', () => {
        const matchup = {
            roster_id: 1,
            points: 85.84,
            starters: ['9493', '4177'],
            players_points: {
                '9493': 0,
                '4177': 2.8
            }
        };

        const result = applyAutoSubs(matchup, { '9493': '4177' }, {});

        expect(result.points).toBe(85.84);
        expect(result.appliedSubs).toEqual([]);
    });
});
