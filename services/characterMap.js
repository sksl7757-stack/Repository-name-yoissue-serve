'use strict';

const CHARACTER_MAP = {
  '하나': 'hana',
  '준혁': 'junhyuk',
  // 앞으로 캐릭터 추가 시 여기에만 추가
  // '뭉치': 'munchi',
};

function getTriggerWord(character) {
  const trigger = CHARACTER_MAP[character];

  if (!trigger) {
    console.warn(`Unknown character: ${character}, fallback to hana`);
    return 'hana';
  }

  return trigger;
}

module.exports = { getTriggerWord };
