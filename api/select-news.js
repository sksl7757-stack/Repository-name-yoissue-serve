const { main } = require('../select-news');

module.exports = async (req, res) => {
  console.log('🌐 API 호출됨:', new Date().toISOString(), req.method);
  try {
    await main();
    res.status(200).json({ ok: true, message: '뉴스 선정 완료' });
  } catch (e) {
    console.error('[Cron 에러]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
};
