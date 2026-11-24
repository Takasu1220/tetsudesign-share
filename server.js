const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

//pass
const ADMIN_SECRET_HASH = process.env.ADMIN_SECRET_HASH || '3b963d930a7f6c9a558e4c532888949a02a5c32d3b838e3d97c1522b3e302c78';

// uploadsフォルダがなければ自動作成する（Render公開時に必須！）
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

function toHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function generateUserId(secretKey) {
  if (!secretKey) return 'ID:guest';
  const hashed = toHash(secretKey);
  if (hashed === ADMIN_SECRET_HASH) return 'KANRININ';
  return 'ID:' + hashed.substring(0, 6);
}

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());

let posts = [];

// 管理人認証API
app.post('/api/verify-admin', (req, res) => {
  if (!req.body.secret) return res.status(401).json({ success: false });
  if (toHash(req.body.secret) === ADMIN_SECRET_HASH) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// 作品一覧取得API
app.get('/api/posts', (req, res) => {
  res.json(posts);
});

// 新規作品投稿API
app.post('/api/posts', upload.single('image'), (req, res) => {
  const userId = generateUserId(req.body.userKey);
  const nowJST = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const newPost = {
    id: Date.now(),
    title: req.body.title,
    author: req.body.author || '名無しの設計士',
    userId: userId,
    description: req.body.description,
    imageUrl: req.file ? `/uploads/${req.file.filename}` : null,
    createdAt: nowJST,
    comments: []
  };
  
  posts.unshift(newPost);
  res.json({ message: '投稿完了！', post: newPost });
});

// コメント追加API
app.post('/api/posts/:id/comments', (req, res) => {
  const postId = Number(req.params.id);
  const post = posts.find(p => p.id === postId);
  if (!post) return res.status(404).json({ error: '作品が見つかりません' });

  const userId = generateUserId(req.body.userKey);
  const nowJST = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const newComment = {
    id: Date.now(),
    author: req.body.author || '名無しの閲覧者',
    userId: userId,
    text: req.body.text,
    createdAt: nowJST
  };

  post.comments.push(newComment);
  res.json({ message: 'コメント追加完了', comment: newComment });
});

// 管理人専用の削除API
app.delete('/api/posts/:id', (req, res) => {
  const userId = generateUserId(req.body.userKey);
  if (userId !== 'KANRININ') return res.status(403).json({ error: '削除権限がありません' });

  const postId = Number(req.params.id);
  const index = posts.findIndex(p => p.id === postId);
  if (index === -1) return res.status(404).json({ error: '作品が見つかりません' });

  const targetPost = posts[index];
  if (targetPost.imageUrl) {
    const filePath = path.join(__dirname, targetPost.imageUrl);
    fs.unlink(filePath, (err) => {
      if (err) console.error('画像ファイルの削除に失敗:', err);
    });
  }

  posts.splice(index, 1);
  res.json({ message: '削除完了' });
});

app.listen(PORT, () => {
  console.log(`サーバー起動中: ポート ${PORT}`);
});

