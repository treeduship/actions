const fs = require('fs');
const yaml = require('js-yaml');
const core = require('@actions/core');

const queryYaml = async (path, query) => {
  const json = await yaml.load(fs.readFileSync(path), 'utf8');
  const keys = query.split('.').filter(Boolean);
  let value = json;
  for (let i = 0, l = keys.length; i < l && value; i++) {
    const key = keys[i];
    console.log(`Getting property '${key}'...`);
    value = value[key];
  }
  return value;
};

const action = async () => {
  try {
    const path = core.getInput('path');
    const query = core.getInput('query');
    const envKey = core.getInput('env-key');
    console.log(`Path: ${path}`);
    console.log(`query: ${query}`);
    console.log(`envKey: ${envKey}`);
    const value = await queryYaml(path, query);
    console.log(`Value: ${value}`);
    core.exportVariable(envKey, value);
  } catch (e) {
    core.setFailed(e.message);
  }
}

action();

