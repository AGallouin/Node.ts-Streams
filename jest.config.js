module.exports = {
    transform: {
      "^.+\\.ts$": ["ts-jest", {
        tsconfig: "tsconfig.json",
      }],
    },
    testRegex: "/__tests__/.*.(spec|test).ts$",
    testPathIgnorePatterns: ["/(node_modules|build)/"],
    testEnvironment: "node",
  };
  