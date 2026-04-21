// 캐릭터 단일 소스 ─ 프론트 yoissue/constants/characters.ts 와 동일 구조.
// 새 캐릭터 추가: (1) 이 파일에 한 줄, (2) 프론트 characters.ts 동일, (3) persona 폴더 양쪽.
// id 는 persona/<id>/ 폴더명과 일치해야 함. name 은 표시용이면서 현재 일부 API 조인 키.
// prompts/persona.js 가 부팅 시 폴더 스캔 ⊆ 레지스트리 검증 → 불일치면 throw.

const CHARACTERS = [
  { id: 'hana',    name: '하나', emoji: '🌸', tier: 'free' },
  { id: 'junhyuk', name: '준혁', emoji: '⚡', tier: 'free' },
];

const CHARACTER_BY_NAME = Object.fromEntries(CHARACTERS.map(c => [c.name, c]));
const CHARACTER_BY_ID   = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));

module.exports = { CHARACTERS, CHARACTER_BY_NAME, CHARACTER_BY_ID };
