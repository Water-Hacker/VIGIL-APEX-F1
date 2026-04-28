/* eslint-env node */
module.exports = {
  '*.{ts,tsx}': ['eslint --max-warnings=0 --fix', 'prettier --write'],
  '*.{js,jsx,cjs,mjs}': ['eslint --max-warnings=0 --fix', 'prettier --write'],
  '*.{json,yml,yaml,md}': ['prettier --write'],
  '*.sol': ['prettier --write --plugin=prettier-plugin-solidity'],
  // Block any commit that touches a path with a known-secret-shaped file
  '.{env,env.*}': () => 'echo "Refusing to commit a .env file" && exit 1',
};
