/* Verba MVP: keeps swear words, slurs and other offensive words out of profile names.
 *
 * The word list and the matching come from obscenity (MIT, vendor/obscenity), which reads
 * through capitals, look-alike characters, and digits or symbols used in place of letters, and
 * has its own exceptions for ordinary words. Verba also reads each name a few more ways: with
 * symbols taken out of each word, with letters typed apart joined up, and with letters typed
 * three or more times cut back.
 *
 * Real names that merely contain a listed word are allowed. ALLOWED holds every such name
 * among the US Census 2010 surnames, US baby names (1880 to 2008), the most common first and
 * last names of other countries, and some common Thai, Yoruba and Japanese names missing from
 * those lists, except plurals of a listed word. A name that is a listed word itself stays
 * refused. No filter catches everything.
 *
 * Works as a classic <script> after vendor/obscenity/obscenity.min.js (window.VerbaNameCheck),
 * and from Node for tests.
 */
var VerbaNameCheck = (function (O) {
    'use strict';

    var ALLOWED = [
        "aarseth", "abplanalp", "addicks", "adickes", "analco", "analise", "analla", "annala", "annalise",
        "annaloro", "anuszewski", "anuszkiewicz", "aplanalp", "arsement", "arunporn", "asse", "assef",
        "assefa", "asseff", "assel", "asselin", "assell", "asselta", "assman", "assmann", "assmus", "asson",
        "assouline", "babich", "baddick", "baldenegro", "banushi", "bastardi", "bastardo", "belanus",
        "bendick", "bendickson", "benjaporn", "biddick", "bobich", "boddicker", "bodick", "boedicker",
        "bombich", "boobar", "boober", "braddick", "briddick", "brondyke", "brundick", "bullerdick", "bundick",
        "burdick", "caddick", "campanale", "canuso", "caponegro", "chaddick", "chadick", "chiddick",
        "chuleeporn", "colfack", "craddick", "cradick", "cuckler", "cumella", "cumer", "cumiford", "cuming",
        "cumings", "cumins", "cumiskey", "cumley", "cumm", "cummens", "cummer", "cumming", "cummings",
        "cummins", "cummiskey", "cummo", "cummons", "cumper", "cumpian", "cumplido", "cumpston", "cumpton",
        "cundick", "danuser", "dardick", "delnegro", "dickamore", "dickard", "dickason", "dickau", "dicke",
        "dickel", "dickelman", "dicken", "dicker", "dickerhoff", "dickerhoof", "dickerman", "dickerson",
        "dickert", "dickeson", "dickess", "dickey", "dickhaus", "dickhausen", "dickhaut", "dickherber",
        "dickhoff", "dickhut", "dickie", "dickins", "dickinson", "dickison", "dickler", "dickman", "dickmann",
        "dickmeyer", "dickneite", "dicko", "dickover", "dickow", "dickrell", "dickson", "dickstein", "dicky",
        "duangporn", "dubich", "dudick", "dykehouse", "dykema", "dykeman", "dykens", "edick", "eidenschink",
        "fabich", "fackelman", "facklam", "fackler", "fackrell", "faga", "fagala", "fagan", "fagans",
        "fagaragan", "fagbemi", "fage", "fagel", "fagen", "fager", "fagerberg", "fagerburg", "fagerland",
        "fagerlie", "fagerlund", "fagerman", "fagerness", "fagerquist", "fagerstrom", "fagg", "faggard",
        "faggart", "faggett", "faggiano", "faggins", "fagin", "fagley", "faglie", "faglier", "fagnan",
        "fagnani", "fagnano", "fagnant", "fagner", "fago", "fagone", "fagot", "fagre", "fague", "fagundes",
        "fagundo", "fanale", "fanus", "fecke", "fecker", "feckner", "fecko", "fedick", "felcher", "felchle",
        "fiffick", "focke", "focken", "fockler", "forgy", "fosdick", "fuka", "fukada", "fuksa", "fukuchi",
        "fukuda", "fukuhara", "fukui", "fukumitsu", "fukumoto", "fukunaga", "fukuoka", "fukushima", "fukutomi",
        "fukuyama", "ganadonegro", "gannuscio", "ganus", "gasmen", "georgy", "gevorgyan", "goedicke",
        "goodyke", "graddick", "gradick", "greidanus", "greydanus", "groendyke", "grubich", "gurganus",
        "gyorgy", "habich", "haddick", "hannus", "hanus", "hanusa", "hardick", "hassanali", "hofacker",
        "hofecker", "hoffacker", "hoffecker", "hornfeck", "hovendick", "hudick", "hufendick", "jadick",
        "jannusch", "jiraporn", "kamonporn", "kanaley", "kanalos", "kanaly", "kanokporn", "kikel", "kikelomo",
        "kikendall", "kiker", "kikkert", "klingsporn", "koedyker", "kordick", "kortendick", "kreibich",
        "kuchinka", "kudick", "kulaporn", "ladick", "lanus", "laudick", "leddick", "liddick", "liebich",
        "liffick", "longendyke", "lubich", "lydick", "mahboob", "mboob", "mcdanal", "mcdannald", "mcgaffick",
        "mcmannus", "medick", "mehboob", "mendick", "moellendick", "monegro", "montanus", "mordick", "murdick",
        "nantaporn", "negrotto", "nordick", "nordyke", "nuchporn", "oberdick", "ollendick", "opdyke", "pabich",
        "panaligan", "panus", "panuska", "papendick", "patcharaporn", "penisten", "penister", "peniston",
        "pennise", "pennisi", "pennison", "penniston", "pianalto", "pimporn", "pornchai", "pornnapa",
        "pornpan", "pornpimol", "pornprapa", "pornpun", "pornsak", "pornsiri", "pornthep", "pornthip",
        "quintanal", "radick", "radicke", "ranaldi", "ranaldo", "ranalli", "ranallo", "rapelje", "raper",
        "rapert", "rapetti", "rappel", "rappenecker", "rattanaporn", "rebich", "rectanus", "reddick",
        "reddicks", "redick", "ribich", "riddick", "ringger", "robich", "roddick", "rodick", "ruddick",
        "rudick", "sadick", "sanusi", "sasiporn", "schink", "schinke", "schinkel", "schinker", "schotanus",
        "semenchuk", "semenick", "semeniuk", "semenko", "semenov", "semenova", "sementa", "sementelli",
        "sementilli", "semenuk", "semenyuk", "semenza", "shadick", "shitara", "shittu", "siriporn", "skannal",
        "sladick", "slutskaya", "slutsky", "slutter", "slutz", "slutzky", "somporn", "sporn", "stadick",
        "stanaland", "stanush", "stevanus", "stibich", "striebich", "stubbendick", "sudaporn", "supaporn",
        "suphaporn", "sylvanus", "tendick", "thitiporn", "thorndyke", "tipaporn", "treworgy", "tschinkel",
        "turdo", "updyke", "urbanus", "valdenegro", "vanalen", "vanallen", "vanaller", "vanallman",
        "vanallsburg", "vanalphen", "vanalst", "vanalstine", "vanalstyne", "vandyke", "vandyken", "vanskike",
        "verdick", "vodicka", "waddick", "wanchaporn", "wandick", "wanke", "wankel", "wanker", "wanket",
        "wankier", "wanko", "wankowski", "wankum", "weadick", "widick", "wilaiporn", "wodicka", "wulfeck",
        "wydick", "wyrosdick", "yanus", "yerbich"
    ];
    var GESTURE = /\u{1F595}/u;   // the raised middle finger emoji

    function make(allowedNames) {
        var matcher = new O.RegExpMatcher(Object.assign({}, O.englishDataset.build(), O.englishRecommendedTransformers));
        // A few entries in obscenity's list do not match their own word as typed; add each such
        // word back as an exact pattern (with doubled letters both kept and single).
        var extra = new O.DataSet().addAll(O.englishDataset), added = 0;
        (O.englishDataset.containers || []).forEach(function (c) {
            var w = c.metadata && c.metadata.originalWord;
            if (!w || matcher.hasMatch(w)) return;
            w = w.toLowerCase();
            extra.addPhrase(function (p) {
                p.setMetadata({ originalWord: w }).addPattern(O.parseRawPattern(w));
                var single = w.replace(/(.)\1+/g, '$1');
                if (single !== w) p.addPattern(O.parseRawPattern(single));
                return p;
            });
            added++;
        });
        if (added) matcher = new O.RegExpMatcher(Object.assign({}, extra.build(), O.englishRecommendedTransformers));
        var known = {};
        allowedNames.forEach(function (n) { known[n] = true; });
        function plain(word) { return word.toLowerCase().replace(/[^\p{L}']+/gu, ''); }

        function readings(name) {
            var words = name.split(/\s+/).filter(function (w) { return w && !known[plain(w)]; });
            var gaps = name.split(/(\s+)/).filter(function (w) { return !known[plain(w)] || /^\s+$/.test(w); }).join('');
            var texts = [words.join(' ')];
            // Symbols taken out of each word; digits and the symbols that stand in for letters stay.
            var bare = words.map(function (w) { return w.replace(/[^\p{L}\p{M}\p{N}@$!|+]+/gu, ''); }).filter(Boolean);
            texts.push(bare.join(' '));
            // Single letters typed apart, joined up.
            var run = '';
            bare.concat(['']).forEach(function (w) {
                if (Array.from(w).length === 1) { run += w; return; }
                if (Array.from(run).length > 1) texts.push(run);
                run = '';
            });
            // Whole phrases typed letter by letter: single spaces join up, wider gaps stay word breaks.
            texts.push(bare.length ? gaps.replace(/[^\p{L}\p{M}\p{N}@$!|+\s]+/gu, '').split(/\s{2,}/).map(function (chunk) {
                var t = chunk.trim().split(' ');
                return t.every(function (x) { return Array.from(x).length === 1; }) ? t.join('') : chunk.trim();
            }).join(' ') : '');
            // Letters typed three or more times in a row, cut back to one and to two.
            return texts.concat(
                texts.map(function (t) { return t.replace(/(\p{L})\1{2,}/gu, '$1'); }),
                texts.map(function (t) { return t.replace(/(\p{L})\1{2,}/gu, '$1$1'); }));
        }
        function allowed(name) {
            var s = String(name || '').normalize('NFKC').replace(/\p{Cf}/gu, '');
            if (GESTURE.test(s)) return false;
            return !readings(s).some(function (t) { return t && matcher.hasMatch(t); });
        }
        return { allowed: allowed, matcher: matcher };
    }

    var api = make(ALLOWED);
    api.make = make;
    api.allowedNames = function () { return ALLOWED.slice(); };
    return api;
}(typeof Obscenity !== 'undefined' ? Obscenity : require('./vendor/obscenity/obscenity.min.js')));

if (typeof window !== 'undefined') window.VerbaNameCheck = VerbaNameCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = VerbaNameCheck;
