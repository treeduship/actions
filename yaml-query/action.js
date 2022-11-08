const fs = require('fs');
const yaml = require('js-yaml');
const core = require('@actions/core');

const queryYaml = async (path, query) => {
  const json = await yaml.load(fs.readFileSync(path), 'utf8');
  const keys = query.split('.').filter(Boolean);
  let value = json;
  for (let i = 0, l = keys.length; i < l && value; i++) {
    const key = keys[i];
    value = value[key];
  }
  return value;
};

try {
  const path = core.getInput('yaml-path');
  const query = core.getInput('yaml-query');
  const envKey = core.getInput('env-key');
  const value = queryYaml(path, query);
  core.exportVariable(envKey, value);
} catch (e) {
  core.setFailed(e.message);
}
