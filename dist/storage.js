/* Browser persistence and portable JSON backups. No application data is sent out. */
const EmberStorage = (() => {
  const KEY = 'emberquest-v4';
  function load() {
    try {
      const own = localStorage.getItem(KEY);
      if (own) return { state: EmberGame.validate(JSON.parse(own)), notice: '' };
      const old = localStorage.getItem('emberquest-v3') || localStorage.getItem('emberquest-v1');
      if (old) return { state: EmberGame.migrate(JSON.parse(old), EmberLegacy), notice: '以前の装備・素材・任務を引き継ぎました。過去の達成は旧版の記録として残ります。' };
    } catch (error) {
      return { state: EmberGame.fresh(), notice: '保存データを読み込めませんでした。元データは変更していません。拠点からバックアップを復元できます。', failed: true };
    }
    return { state: EmberGame.fresh(), notice: '' };
  }
  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  function serialize(state) {
    return JSON.stringify({ format: 'emberquest-backup', version: 4, exportedAt: new Date().toISOString(), data: state }, null, 2);
  }
  function parse(text) {
    const parsed = JSON.parse(text), data = parsed.data || parsed;
    if (data.version === 4) return EmberGame.validate(data);
    if (data.version === 3) return EmberGame.migrate(data, EmberLegacy);
    throw Error('EMBERQUESTのバックアップを選んでください。');
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return { KEY, load, save, serialize, parse, download };
})();
