module.exports = {
  printWidth: 100,
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  endOfLine: 'lf',

  // import 並び替え（@trivago/prettier-plugin-sort-imports）
  importOrder: ['^@aws-sdk/(.*)$', '^react(.*)$', '^@asanowa/(.*)$', '^@exabugs/(.*)$', '^[./]'],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  importOrderParserPlugins: ['typescript', 'jsx'],

  plugins: ['@trivago/prettier-plugin-sort-imports'],
};
