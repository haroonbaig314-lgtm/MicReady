# Word lists for the MVP's other languages

`wordlists.js` holds swear words, slurs and other offensive words in Spanish, French, Mandarin,
German, Japanese, Arabic, Hindi, Korean, Italian and Russian, for the profile name check
(`namecheck.js`). English comes from `vendor/obscenity`.

Sources:

- [List of Dirty, Naughty, Obscene, and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
  (LDNOOBW), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [cuss](https://github.com/words/cuss) 2.2.0 by Titus Wormer: Spanish, French, Italian and romanized
  Arabic, only the words it rates as certainly profane. MIT, see `LICENSE-cuss`.
- [hinglish-profanity](https://github.com/mathpalnaman/hinglish-profanity) 0.2.0 by Naman Mathpal:
  Hindi in Devanagari. MIT, see `LICENSE-hinglish-profanity`.

Changes made: the lists were merged, lower-cased and stripped of accents (except the Spanish n with
a tilde). 161 entries were removed because they are also common surnames or given names (US Census
2010 surnames, US baby names 1880 to 2008, common names of other countries) and ordinary words
first, such as Colón, Peter, Regina, Lund and Concha. Russian also gets 8 word pieces shared by
three or more listed words, matched anywhere in a word. Checked against 8,453 Korean, Chinese,
Japanese, Arabic, Hindi and Russian names in their own scripts: none is refused.

The data is stored as base64-encoded JSON, so the source file does not spell the words out.
