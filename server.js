import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});
const ai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) console.warn('Falta JWT_SECRET en las variables de entorno.');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 250 }));
app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = u => ({
  id: u.id, name: u.name, age: u.age, city: u.city, bio: u.bio,
  photoUrl: u.photo_url, interests: u.interests || []
});
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Sesión vencida. Volvé a iniciar sesión.' }); }
}

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'ConectaMente', version: '5.0' }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password, age, city = '' } = req.body || {};
  if (!name || !email || !password || !age) return res.status(400).json({ error: 'Completá nombre, email, contraseña y edad.' });
  if (Number(age) < 18) return res.status(403).json({ error: 'Esta plataforma está destinada a mayores de 18 años.' });
  if (Number(age) > 100 || !Number.isInteger(Number(age))) return res.status(400).json({ error: 'La edad no es válida.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  const cleanEmail = String(email).trim().toLowerCase();
  const hash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users(name,email,password_hash,age,city) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [String(name).trim().slice(0,60), cleanEmail, hash, Number(age), String(city).slice(0,100)]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese email ya está registrado.' });
    throw e;
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await pool.query('SELECT * FROM users WHERE email=$1', [String(email || '').trim().toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash)))
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
}));

app.get('/api/me', auth, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ user: publicUser(r.rows[0]) });
}));

app.patch('/api/me', auth, asyncRoute(async (req, res) => {
  const { name, city, bio, photoUrl, interests } = req.body || {};
  const safeInterests = Array.isArray(interests) ? interests.slice(0, 20).map(x => String(x).slice(0,40)) : [];
  const r = await pool.query(
    `UPDATE users SET name=COALESCE($1,name), city=COALESCE($2,city),
     bio=COALESCE($3,bio), photo_url=COALESCE($4,photo_url), interests=$5
     WHERE id=$6 RETURNING *`,
    [name ? String(name).slice(0,60) : null, city == null ? null : String(city).slice(0,100),
     bio == null ? null : String(bio).slice(0,500), photoUrl == null ? null : String(photoUrl).slice(0,2000),
     safeInterests, req.user.id]
  );
  res.json({ user: publicUser(r.rows[0]) });
}));

app.get('/api/discover', auth, asyncRoute(async (req, res) => {
  const r = await pool.query(
    `SELECT u.* FROM users u WHERE u.id<>$1
     AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_user=$1 AND l.to_user=u.id)
     AND NOT EXISTS (SELECT 1 FROM matches m WHERE (m.user_a=LEAST($1,u.id) AND m.user_b=GREATEST($1,u.id)))
     ORDER BY u.created_at DESC LIMIT 40`, [req.user.id]
  );
  res.json({ profiles: r.rows.map(publicUser) });
}));

app.post('/api/likes', auth, asyncRoute(async (req, res) => {
  const target = Number(req.body?.userId);
  if (!Number.isInteger(target) || target === req.user.id) return res.status(400).json({ error: 'Perfil inválido.' });
  const other = await pool.query('SELECT id FROM users WHERE id=$1', [target]);
  if (!other.rowCount) return res.status(404).json({ error: 'Perfil no encontrado.' });
  await pool.query('INSERT INTO likes(from_user,to_user) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, target]);
  const reciprocal = await pool.query('SELECT 1 FROM likes WHERE from_user=$1 AND to_user=$2', [target, req.user.id]);
  if (reciprocal.rowCount) {
    const a = Math.min(req.user.id, target), b = Math.max(req.user.id, target);
    const m = await pool.query(
      'INSERT INTO matches(user_a,user_b) VALUES($1,$2) ON CONFLICT(user_a,user_b) DO UPDATE SET user_a=EXCLUDED.user_a RETURNING id',
      [a,b]
    );
    return res.json({ matched: true, matchId: m.rows[0].id });
  }
  res.json({ matched: false });
}));

app.get('/api/matches', auth, asyncRoute(async (req, res) => {
  const r = await pool.query(
    `SELECT m.id, u.id AS user_id,u.name,u.age,u.city,u.bio,u.photo_url,u.interests
     FROM matches m JOIN users u ON u.id=CASE WHEN m.user_a=$1 THEN m.user_b ELSE m.user_a END
     WHERE m.user_a=$1 OR m.user_b=$1 ORDER BY m.created_at DESC`, [req.user.id]
  );
  res.json({ matches: r.rows.map(x => ({ matchId:x.id, user:publicUser({
    id:x.user_id,name:x.name,age:x.age,city:x.city,bio:x.bio,photo_url:x.photo_url,interests:x.interests
  }) })) });
}));

async function ownedMatch(matchId, userId) {
  const r = await pool.query('SELECT * FROM matches WHERE id=$1 AND (user_a=$2 OR user_b=$2)', [matchId,userId]);
  return r.rows[0];
}
app.get('/api/matches/:id/messages', auth, asyncRoute(async (req,res) => {
  const m = await ownedMatch(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error:'Conversación no encontrada.' });
  const r = await pool.query(
    `SELECT id,sender_id AS "senderId",body,created_at AS "createdAt" FROM messages
     WHERE match_id=$1 ORDER BY created_at ASC LIMIT 200`, [m.id]
  );
  res.json({ messages:r.rows });
}));
app.post('/api/matches/:id/messages', auth, asyncRoute(async (req,res) => {
  const m = await ownedMatch(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error:'Conversación no encontrada.' });
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 2000) return res.status(400).json({ error:'El mensaje debe tener entre 1 y 2000 caracteres.' });
  const r = await pool.query(
    `INSERT INTO messages(match_id,sender_id,body) VALUES($1,$2,$3)
     RETURNING id,sender_id AS "senderId",body,created_at AS "createdAt"`,
    [m.id,req.user.id,body]
  );
  res.status(201).json({ message:r.rows[0] });
}));

app.post('/api/ai/reply', auth, asyncRoute(async (req,res) => {
  if (!ai) return res.status(503).json({ error:'La IA todavía no está configurada. Agregá OPENAI_API_KEY en el servidor.' });
  const { message, interests = [], conversation = [] } = req.body || {};
  if (!message || String(message).length > 2000) return res.status(400).json({ error:'Mensaje inválido.' });
  const safeHistory = Array.isArray(conversation) ? conversation.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0,1000)
  })) : [];
  const completion = await ai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role:'system', content:'Sos un asistente que sugiere respuestas cálidas, naturales y breves para iniciar o continuar una amistad. No finjas ser una persona real ni inventes datos personales. Respondé en español rioplatense, con respeto y sin presión. Devolvé solo una sugerencia de mensaje.' },
      { role:'system', content:`Intereses mencionados: ${interests.slice(0,12).map(x=>String(x).slice(0,40)).join(', ')}` },
      ...safeHistory,
      { role:'user', content:String(message).slice(0,2000) }
    ],
    max_tokens:140
  });
  res.json({ reply:completion.choices[0]?.message?.content?.trim() || '¡Qué bueno! Contame un poco más.' });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error:'Ocurrió un error en el servidor. Intentá nuevamente.' });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`ConectaMente escuchando en puerto ${port}`));
