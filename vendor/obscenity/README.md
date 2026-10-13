# obscenity

The word list and matcher behind the profile name check (`namecheck.js`).

- Package: [obscenity](https://github.com/jo3-l/obscenity) 0.4.6 by Joseph Liu, MIT License (see `LICENSE`).
- `obscenity.min.js` is a browser bundle of the package's `RegExpMatcher`, `DataSet`, `parseRawPattern`,
  `englishDataset` and `englishRecommendedTransformers`, built with esbuild 0.25.0:

  ```
  esbuild entry.js --bundle --format=iife --global-name=Obscenity --minify --target=es2018
  ```

  where `entry.js` re-exports those names from `obscenity/dist/index.mjs`. A one-line footer also
  exports the bundle to Node, for the tests.
