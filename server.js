const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// 環境変数から設定を読み込む（未設定時は 'London21' のハッシュを使用）
const ADMIN_SECRET_HASH = process.env.ADMIN_SECRET_HASH || '3b963d930a7f6c9a558e4c532888949a02a5c32d3b838e3d97c1522b3e302c78';
const DATABASE_URL = process.env.DATABASE_URL;

// Neon（PostgreSQL）と接続
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function toHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function generateUserId(secretKey) {
  if (!secretKey) return 'ID:guest';
  const hashed = toHash(secretKey);
  if (hashed === ADMIN_SECRET_HASH) return 'KANRININ';
  return 'ID:' + hashed.substring(0, 6);
}

// 画像はメモリ上で受け取り（最大5MBまで）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.static('public'));
app.use(express.json());

// 管理人認証API
app.post('/api/verify-admin', (req, res) => {
  if (!req.body.secret) return res.status(401).json({ success: false });
  if (toHash(req.body.secret) === ADMIN_SECRET_HASH) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// 1. 作品一覧をNeonから取得
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
    const formatted = result.rows.map(row => ({
      id: Number(row.id),
      title: row.title,
      author: row.author,
      userId: row.user_id,
      description: row.description,
      imageUrl: row.image_data,
      createdAt: row.created_at,
      comments: row.comments || []
    }));
    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'データ取得エラー' });
  }
});

// 2. 新規作品をNeonへ投稿
app.post('/api/posts', upload.single('image'), async (req, res) => {
  try {
    const userId = generateUserId(req.body.userKey);
    const nowJST = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const id = Date.now();

    let imageData = null;
    if (req.file) {
      const base64 = req.file.buffer.toString('base64');
      imageData = `data:${req.file.mimetype};base64,${base64}`;
    }

    await pool.query(
      'INSERT INTO posts (id, title, author, user_id, description, image_data, created_at, comments) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        id,
        req.body.title,
        req.body.author || '名無しの設計士',
        userId,
        req.body.description,
        imageData,
        nowJST,
        JSON.stringify([])
      ]
    );

    res.json({ message: '投稿完了！' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '投稿保存エラー' });
  }
});

// 3. コメント追加
app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const result = await pool.query('SELECT comments FROM posts WHERE id = $1', [postId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '作品が見つかりません' });
    }

    const userId = generateUserId(req.body.userKey);
    const nowJST = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const newComment = {
      id: Date.now(),
      author: req.body.author || '名無しの閲覧者',
      userId: userId,
      text: req.body.text,
      createdAt: nowJST
    };

    const currentComments = result.rows[0].comments || [];
    const updatedComments = [...currentComments, newComment];

    await pool.query(
      'UPDATE posts SET comments = $1 WHERE id = $2',
      [JSON.stringify(updatedComments), postId]
    );

    res.json({ message: 'コメント追加完了' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'コメント保存エラー' });
  }
});

// 4. 管理人専用の削除機能
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const userId = generateUserId(req.body.userKey);
    if (userId !== 'KANRININ') {
      return res.status(403).json({ error: '削除権限がありません' });
    }

    const postId = Number(req.params.id);
    await pool.query('DELETE FROM posts WHERE id = $1', [postId]);

    res.json({ message: '削除完了' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '削除エラー' });
  }
});

app.listen(PORT, () => {
  console.log(`サーバー起動中: ポート ${PORT}`);
});

