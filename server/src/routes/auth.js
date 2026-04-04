const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { JWT_SECRET }  = require('../config');
const { requireAuth } = require('../middleware/auth');
const cafeService     = require('../services/cafe.service');

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  const { name, slug, email, password } = req.body;
  if (!name || !slug || !email || !password)
    return res.status(400).json({ error: '모든 필드를 입력하세요' });

  if (!/^[a-z0-9-]+$/.test(slug))
    return res.status(400).json({ error: 'slug는 영소문자, 숫자, 하이픈만 사용 가능합니다' });

  if (await cafeService.findBySlug(slug))
    return res.status(409).json({ error: '이미 사용 중인 slug입니다' });

  const passwordHash = await bcrypt.hash(password, 10);
  const cafe = await cafeService.create({ name, slug, ownerEmail: email, passwordHash });

  const token = jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, cafe: { id: cafe.id, name: cafe.name, slug: cafe.slug } });
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const cafe = await cafeService.findByEmail(email);
  if (!cafe || !(await bcrypt.compare(password, cafe.password_hash)))
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });

  const token = jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, cafe: { id: cafe.id, name: cafe.name, slug: cafe.slug } });
});

// POST /api/v1/auth/disclaimer  (JWT 필요)
router.post('/disclaimer', requireAuth, async (req, res) => {
  await cafeService.update(req.owner.cafeId, { disclaimer_accepted_at: new Date() });
  res.json({ ok: true });
});

module.exports = router;
