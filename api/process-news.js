const { main } = require('../process-news');

module.exports = async (req, res) => {
  console.log('🌐 process-news API 호출됨:', new Date().toISOString(), req.method);
  try {
    await main();
    res.status(200).json({ ok: true, message: '뉴스 처리 완료' });
  } catch (e) {
    console.error('[process-news 에러]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
};
