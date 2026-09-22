module.exports = {
  root: true,
  extends: ['react-native-wcandillon', 'prettier'],
  plugins: [
    // ... other plugins
    'jest',
  ],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'import/no-useless-path-segments': 'off',
    'no-unused-vars': 'off',
  },
  env: {
    // ... other environments
    'jest/globals': true,
  },
  overrides: [
    {
      // Build-time Node scripts, not app code: CommonJS, and they legitimately
      // use Buffer, process and require.
      files: ['scripts/**/*.js'],
      env: { node: true, es2022: true },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-undef': 'off',
        'no-bitwise': 'off',
      },
    },
  ],
};
