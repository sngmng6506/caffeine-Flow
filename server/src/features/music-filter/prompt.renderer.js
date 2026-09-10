const path = require('node:path');
const nunjucks = require('nunjucks');

// LLM용 일반 텍스트다. 입력값은 다시 템플릿으로 해석하지 않는다.
const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(__dirname, 'prompts'), { noCache: false }),
  { autoescape: false, throwOnUndefined: true },
);
const templates = new Set([
  'music-filter.system.njk', 'music-filter.user.njk',
  'public-guide.system.njk', 'public-guide.user.njk',
]);

function renderPrompt(name, context = {}) {
  if (!templates.has(name)) throw new Error('등록되지 않은 프롬프트입니다');
  return environment.render(name, context);
}

module.exports = { renderPrompt };
