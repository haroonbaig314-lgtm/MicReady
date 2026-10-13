// Group practice: turning the voice checks of a session into each person's own results
// (voiceid.js attribute). Pure logic, no browser needed.
const { test, expect } = require('@playwright/test');
const V = require('../voiceid.js');

const CAL = { switchCost: 0.1, unknown: 0.35, longPause: 3 };   // as in voice.js
// One 3 s check every 1.5 s of speech; `who` names the voice heard in each check.
function checks(who, t0 = 0) {
    const sims = { me: { me: 0.8, sam: 0.1 }, sam: { me: 0.08, sam: 0.78 }, guest: { me: 0.12, sam: 0.15 }, mix: { me: 0.45, sam: 0.42 } };
    return who.map((w, k) => ({ from: t0 + k * 1500, to: t0 + k * 1500 + 3000, scores: Object.assign({}, typeof w === 'string' ? sims[w] : w) }));
}

test('two people taking turns each get their own speaking time, "um"s, pauses and words', () => {
    // Me speaks for 12 checks (0 to 19.5 s), then Sam for 12 (19.5 to 37.5 s).
    const W = checks([...Array(12).fill('me'), ...Array(12).fill('sam')]);
    const ev = {
        hes: [5000, 12000, 26000],
        pauses: [{ t: 10000, d: 1.2 }, { t: 20500, d: 0.9 }, { t: 30000, d: 3.5 }],   // Me's own, the hand-off, Sam's own (long)
        chunks: [{ start: 1000, end: 9000, words: 22, hedges: 1, hes: 0, fil: 1 }, { start: 21000, end: 36000, words: 40, hedges: 0, hes: 1, fil: 0 }]
    };
    const A = V.attribute(W, ev, CAL);
    expect(A.labels.slice(0, 12).every(l => l === 'me')).toBe(true);
    expect(A.labels.slice(12).every(l => l === 'sam')).toBe(true);
    const me = A.people.me, sam = A.people.sam;
    expect(me.hes).toBe(2);
    expect(sam.hes).toBe(2);                       // one heard, one from the transcript
    expect(me.fil).toBe(3);                         // two "um"s plus one filler word
    expect([me.pauses, sam.pauses, sam.longPauses]).toEqual([1, 1, 1]);
    expect(A.handoffs).toEqual([{ from: 'me', to: 'sam', d: 0.9 }]);
    expect([me.words, sam.words, me.hedges]).toEqual([22, 40, 1]);
    expect(me.talk + sam.talk).toBeCloseTo(37.5 - 0.9, 5);   // the hand-off silence is nobody's
    // The change of speaker sits in the middle of the hand-off silence (19.6 to 20.5 s).
    expect(A.turns.map(t => t.id)).toEqual(['me', 'sam']);
    expect(A.turns[0].to).toBe(20050);
    expect(A.speakerAt(3000)).toBe('me');
    expect(A.speakerAt(30000)).toBe('sam');
});

test('a single doubtful check does not split a turn, and a mixed check at a hand-off goes to one side', () => {
    const slip = { me: 0.5, sam: 0.56 };
    const W = checks(['me', 'me', 'me', slip, 'me', 'me', 'mix', 'sam', 'sam', 'sam', 'sam']);
    const A = V.attribute(W, {}, CAL);
    expect(A.labels.slice(0, 6)).toEqual(['me', 'me', 'me', 'me', 'me', 'me']);
    expect(A.labels.slice(7)).toEqual(['sam', 'sam', 'sam', 'sam']);
});

test('someone who is not enrolled is nobody\'s, and their "um"s count for no one', () => {
    const W = checks([...Array(8).fill('me'), ...Array(8).fill('guest'), ...Array(8).fill('sam')]);
    const A = V.attribute(W, { hes: [17000, 18000, 19000] }, CAL);
    expect(A.labels.slice(9, 15).every(l => l === 'unknown')).toBe(true);
    expect(A.people.unknown.hes).toBe(3);
    expect(A.people.me.hes).toBe(0);
    expect(A.people.sam.hes).toBe(0);
});

test('a short session or no checks at all', () => {
    expect(V.attribute([], { hes: [1000], chunks: [{ start: 0, end: 900, words: 3 }] }, CAL).people.unknown.words).toBe(3);
    const one = V.attribute(checks(['sam']), { hes: [2000] }, CAL);
    expect(one.labels).toEqual(['sam']);
    expect(one.people.sam.hes).toBe(1);
});
