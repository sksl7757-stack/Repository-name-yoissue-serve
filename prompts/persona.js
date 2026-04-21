// prompts/persona.js — persona 폴더 자동 스캔.
// 기존 generator.js 의 최상단 side-effect 로드를 격리.

const fs   = require('fs');
const path = require('path');

const personaDir = path.join(__dirname, '..', 'persona');
const personaMap = {};

fs.readdirSync(personaDir).forEach(folder => {
  const promptPath = path.join(personaDir, folder, 'prompt.js');
  if (!fs.existsSync(promptPath)) return;
  const persona = require(promptPath);
  if (persona.charName) personaMap[persona.charName] = persona;
});

function getPersona(character) {
  return personaMap[character] || null;
}

// 해당 모드에 맞는 base prompt 한 필드를 반환. persona 에 없으면 빈 문자열.
function basePromptFor(persona, { isMourning, primaryCharName, isOpinion }) {
  if (!persona) return '';
  if (isMourning)     return persona.mourningPrompt || persona.corePersona || '';
  if (primaryCharName) return persona.corePersona  || '';
  if (isOpinion)      return persona.opinionPrompt || '';
  return persona.conversePrompt || '';
}

module.exports = { getPersona, basePromptFor };
