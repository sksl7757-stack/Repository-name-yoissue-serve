// prompts/persona.js — persona 폴더 스캔 + characters.js 레지스트리 교차 검증.
// 불일치(폴더만 있거나 레지스트리에만 있거나 charName 이 name 과 다르면) 즉시 throw → 부팅 실패.

const fs   = require('fs');
const path = require('path');
const { CHARACTERS } = require('../characters');

const personaDir = path.join(__dirname, '..', 'persona');
const personaMap = {};

const foundFolders = fs.readdirSync(personaDir).filter(f =>
  fs.existsSync(path.join(personaDir, f, 'prompt.js'))
);

for (const { id, name } of CHARACTERS) {
  if (!foundFolders.includes(id)) {
    throw new Error(`[persona] 레지스트리에 '${id}' 있지만 persona/${id}/prompt.js 누락`);
  }
  const persona = require(path.join(personaDir, id, 'prompt.js'));
  if (persona.charName !== name) {
    throw new Error(`[persona] persona/${id}/prompt.js 의 charName='${persona.charName}' ≠ 레지스트리 name='${name}'`);
  }
  personaMap[name] = persona;
}

const orphan = foundFolders.filter(f => !CHARACTERS.some(c => c.id === f));
if (orphan.length) {
  throw new Error(`[persona] persona 폴더 ${orphan.join(', ')} 가 characters.js 에 등록되지 않음`);
}

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
