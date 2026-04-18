const { main } = require('../send-push');

module.exports = async (req, res) => {
  console.log('🌐 send-push API 호출됨:', new Date().toISOString(), req.method);
  try {
    await main();
    res.status(200).json({ ok: true, message: '푸시 발송 완료' });
  } catch (e) {
    console.error('[send-push 에러]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
};
