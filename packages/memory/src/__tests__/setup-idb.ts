/**
 * 测试环境 setup：为 happy-dom / node 注入 fake-indexeddb，让 Dexie 可以跑。
 * 在每个 test 文件顶部 `import './setup-idb';` 即可。
 */
import 'fake-indexeddb/auto';
