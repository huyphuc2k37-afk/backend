/**
 * Seed Categories, Tags, and migrate existing Story data.
 *
 * Usage:
 *   npx ts-node scripts/seed-categories-tags.ts           # dry-run
 *   npx ts-node scripts/seed-categories-tags.ts --execute  # real run
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const isDryRun = !process.argv.includes("--execute");
const isForce = process.argv.includes("--force");

/* ── Vietnamese slug helper ── */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ══════════════════════════════════════════════════
   1. CATEGORIES (8 main categories)
   ══════════════════════════════════════════════════ */
const CATEGORIES = [
  {
    name: "Tình cảm",
    slug: "tinh-cam",
    description: "Truyện tình cảm, ngôn tình, đam mỹ, bách hợp, LGBT+ và các mối quan hệ lãng mạn.",
    seoTitle: "Truyện Tình Cảm Hay Nhất — Ngôn Tình, Đam Mỹ, Bách Hợp | VStory",
    seoDescription: "Tổng hợp truyện tình cảm mới nhất, hot và full — ngôn tình, đam mỹ, bách hợp, LGBT+. Đọc online miễn phí & trả phí trên VStory.",
    icon: "💕",
    color: "#e11d48",
    displayOrder: 1,
  },
  {
    name: "Huyền huyễn & Giả tưởng",
    slug: "gia-tuong-huyen-huyen",
    description: "Truyện huyền huyễn, tu tiên, dị giới, dị năng, kỳ ảo và thế giới giả tưởng.",
    seoTitle: "Truyện Huyền Huyễn, Tu Tiên, Giả Tưởng Hay | VStory",
    seoDescription: "Đọc truyện huyền huyễn, tu tiên, dị giới, fantasy hay nhất. Hàng nghìn tác phẩm miễn phí, cập nhật liên tục trên VStory.",
    icon: "✨",
    color: "#7c3aed",
    displayOrder: 2,
  },
  {
    name: "Khoa học viễn tưởng",
    slug: "khoa-hoc-tuong-lai",
    description: "Truyện khoa học viễn tưởng, sci-fi, robot, AI, công nghệ tương lai.",
    seoTitle: "Truyện Khoa Học Viễn Tưởng Hay — Sci-Fi | VStory",
    seoDescription: "Khám phá truyện khoa học viễn tưởng, sci-fi, AI, robot, tương lai. Đọc miễn phí trên VStory.",
    icon: "🚀",
    color: "#0891b2",
    displayOrder: 3,
  },
  {
    name: "Xuyên không & Trọng sinh",
    slug: "xuyen-khong",
    description: "Truyện xuyên không, trọng sinh, trùng sinh, xuyên sách, hệ thống.",
    seoTitle: "Truyện Xuyên Không, Trọng Sinh Hay Nhất | VStory",
    seoDescription: "Đọc truyện xuyên không, trọng sinh, xuyên sách, hệ thống hay nhất miễn phí. Cập nhật liên tục trên VStory.",
    icon: "🔄",
    color: "#059669",
    displayOrder: 4,
  },
  {
    name: "Kinh dị & Tâm linh",
    slug: "kinh-di-tam-linh",
    description: "Truyện kinh dị, tâm linh, ma quỷ, rùng rợn, bí ẩn siêu nhiên.",
    seoTitle: "Truyện Kinh Dị, Tâm Linh, Truyện Ma Hay | VStory",
    seoDescription: "Tuyển tập truyện kinh dị, tâm linh, truyện ma rùng rợn. Đọc miễn phí tại VStory.",
    icon: "👻",
    color: "#374151",
    displayOrder: 5,
  },
  {
    name: "Học đường & Đời thường",
    slug: "hoc-duong-do-thi",
    description: "Truyện học đường, đô thị, đời thường, văn phòng, showbiz, cổ đại.",
    seoTitle: "Truyện Học Đường, Đô Thị, Đời Thường Hay | VStory",
    seoDescription: "Đọc truyện học đường, đô thị, văn phòng, cổ đại, hiện đại hay nhất miễn phí trên VStory.",
    icon: "🏫",
    color: "#2563eb",
    displayOrder: 6,
  },
  {
    name: "Tâm lý & Tội phạm",
    slug: "tam-ly-toi-pham",
    description: "Truyện tâm lý, tội phạm, trinh thám, bí ẩn, thế giới ngầm.",
    seoTitle: "Truyện Tâm Lý, Tội Phạm, Trinh Thám Hay | VStory",
    seoDescription: "Tuyển tập truyện tâm lý, tội phạm, trinh thám hấp dẫn. Đọc miễn phí trên VStory.",
    icon: "🔍",
    color: "#b45309",
    displayOrder: 7,
  },
  {
    name: "Fanfic & Light novel",
    slug: "fanfic-light-novel",
    description: "Fanfic, light novel, oneshot, truyện ngắn, tản văn và các hình thức tác phẩm khác.",
    seoTitle: "Fanfic, Light Novel Tiếng Việt Hay | VStory",
    seoDescription: "Đọc fanfic, light novel, oneshot, truyện ngắn hay nhất tiếng Việt. Miễn phí trên VStory.",
    icon: "📖",
    color: "#c026d3",
    displayOrder: 8,
  },
];

/* ══════════════════════════════════════════════════
   2. TAGS — All genres mapped to tags with types
   ══════════════════════════════════════════════════ */
interface TagDef {
  name: string;
  slug: string;
  type: string;
}

const TAGS: TagDef[] = [
  // ── genre: Tình cảm ──
  { name: "Ngôn tình", slug: "ngon-tinh", type: "genre" },
  { name: "Đam mỹ", slug: "dam-my", type: "genre" },
  { name: "LGBT+", slug: "lgbt", type: "genre" },
  { name: "Bách hợp", slug: "bach-hop", type: "genre" },
  { name: "Thanh mai trúc mã", slug: "thanh-mai-truc-ma", type: "genre" },
  { name: "Cưỡng chế yêu", slug: "cuong-che-yeu", type: "genre" },
  { name: "Sinh tử văn", slug: "sinh-tu-van", type: "genre" },
  { name: "ABO", slug: "abo", type: "genre" },

  // ── genre: Huyền huyễn & Giả tưởng ──
  { name: "Huyền huyễn", slug: "huyen-huyen", type: "genre" },
  { name: "Hiện đại kỳ ảo", slug: "hien-dai-ky-ao", type: "genre" },
  { name: "Dị giới", slug: "di-gioi", type: "genre" },
  { name: "Dị năng", slug: "di-nang", type: "genre" },
  { name: "Tu tiên", slug: "tu-tien", type: "genre" },
  { name: "Thú nhân", slug: "thu-nhan", type: "genre" },
  { name: "Thần thú", slug: "than-thu", type: "genre" },

  // ── genre: Khoa học viễn tưởng ──
  { name: "Khoa học viễn tưởng", slug: "khoa-hoc-vien-tuong", type: "genre" },
  { name: "Robot", slug: "robot", type: "genre" },
  { name: "AI", slug: "ai", type: "genre" },

  // ── genre: Xuyên không & Trọng sinh ──
  { name: "Xuyên không", slug: "xuyen-khong", type: "genre" },
  { name: "Xuyên sách", slug: "xuyen-sach", type: "genre" },
  { name: "Xuyên game", slug: "xuyen-game", type: "genre" },
  { name: "Xuyên nhanh", slug: "xuyen-nhanh", type: "genre" },
  { name: "Trọng sinh", slug: "trong-sinh", type: "genre" },
  // "Trùng sinh" merged into "Trọng sinh" — same slug
  { name: "Hoán đổi linh hồn", slug: "hoan-doi-linh-hon", type: "genre" },
  { name: "Hệ thống", slug: "he-thong", type: "genre" },

  // ── genre: Kinh dị & Tâm linh ──
  { name: "Kinh dị", slug: "kinh-di", type: "genre" },
  { name: "Tâm linh", slug: "tam-linh", type: "genre" },
  { name: "Minh hôn", slug: "minh-hon", type: "genre" },

  // ── genre: Tâm lý & Tội phạm ──
  { name: "Tâm lý", slug: "tam-ly", type: "genre" },
  { name: "Tâm lý tội phạm", slug: "tam-ly-toi-pham", type: "genre" },

  // ── setting: Bối cảnh & thời đại ──
  { name: "Học đường", slug: "hoc-duong", type: "setting" },
  { name: "Văn phòng công sở", slug: "van-phong-cong-so", type: "setting" },
  { name: "Thương trường", slug: "thuong-truong", type: "setting" },
  { name: "Showbiz", slug: "showbiz", type: "setting" },
  { name: "Quân nhân", slug: "quan-nhan", type: "setting" },
  { name: "Hiện đại", slug: "hien-dai", type: "setting" },
  { name: "Cổ đại", slug: "co-dai", type: "setting" },
  { name: "Tương lai", slug: "tuong-lai", type: "setting" },
  { name: "Tiền sử", slug: "tien-su", type: "setting" },
  { name: "Mạt thế", slug: "mat-the", type: "setting" },
  { name: "Tận thế", slug: "tan-the", type: "setting" },
  { name: "Chiến tranh", slug: "chien-tranh", type: "setting" },
  { name: "Việt Nam", slug: "viet-nam", type: "setting" },

  // ── tone: Tâm lý & cảm xúc ──
  { name: "Ngược tâm", slug: "nguoc-tam", type: "tone" },
  { name: "Ngược nhẹ", slug: "nguoc-nhe", type: "tone" },
  { name: "Ngọt ngào", slug: "ngot-ngao", type: "tone" },
  { name: "Thuần ngọt", slug: "thuan-ngot", type: "tone" },
  { name: "Chữa lành", slug: "chua-lanh", type: "tone" },

  // ── content: Hướng nội dung ──
  { name: "Góc nhìn nữ chính", slug: "goc-nhin-nu-chinh", type: "perspective" },
  { name: "Góc nhìn nam chính", slug: "goc-nhin-nam-chinh", type: "perspective" },
  { name: "Làm ruộng", slug: "lam-ruong", type: "content" },
  { name: "Ẩm thực", slug: "am-thuc", type: "content" },
  { name: "Livestream", slug: "livestream", type: "content" },
  { name: "E-sport", slug: "e-sport", type: "content" },
  { name: "Thể thao", slug: "the-thao", type: "content" },
  { name: "Thế giới mạng", slug: "the-gioi-mang", type: "content" },
  { name: "Thế giới ngầm", slug: "the-gioi-ngam", type: "content" },

  // ── relation: Hình thức quan hệ ──
  { name: "1x1", slug: "1x1", type: "relation" },
  { name: "NP / Harem", slug: "np-harem", type: "relation" },
  { name: "Không CP", slug: "khong-cp", type: "relation" },
  { name: "Tình cảm sâu sắc", slug: "tinh-cam-sau-sac", type: "relation" },
  { name: "Lãng mạn", slug: "lang-man", type: "relation" },
  { name: "Drama tình cảm", slug: "drama-tinh-cam", type: "relation" },
  { name: "Quan hệ phức tạp", slug: "quan-he-phuc-tap", type: "relation" },

  // ── ending: Kết thúc truyện ──
  { name: "HE (Happy Ending)", slug: "he-happy-ending", type: "ending" },
  { name: "SE (Sad Ending)", slug: "se-sad-ending", type: "ending" },
  { name: "OE (Open Ending)", slug: "oe-open-ending", type: "ending" },
  { name: "BE (Bad Ending)", slug: "be-bad-ending", type: "ending" },
  { name: "GE (Good Ending)", slug: "ge-good-ending", type: "ending" },

  // ── form: Hình thức tác phẩm ──
  { name: "Tự truyện", slug: "tu-truyen", type: "form" },
  { name: "Tản văn", slug: "tan-van", type: "form" },
  { name: "Light novel", slug: "light-novel", type: "form" },
  { name: "Fanfic", slug: "fanfic", type: "form" },
  { name: "Oneshot", slug: "oneshot", type: "form" },
  { name: "Truyện ngắn", slug: "truyen-ngan", type: "form" },
  { name: "Tiểu thuyết", slug: "tieu-thuyet", type: "form" },

  // ── origin: Xuất xứ / tình trạng dịch ──
  { name: "Truyện dịch", slug: "truyen-dich", type: "origin" },
  { name: "Trung Quốc", slug: "trung-quoc", type: "origin" },
  { name: "Hàn Quốc", slug: "han-quoc", type: "origin" },
  { name: "Nhật Bản", slug: "nhat-ban", type: "origin" },
  { name: "Âu Mỹ", slug: "au-my", type: "origin" },
  { name: "Việt hóa", slug: "viet-hoa", type: "origin" },
];

/* ══════════════════════════════════════════════════
   3. GENRE → CATEGORY MAPPING
   Maps the old `genre` string to a category slug.
   ══════════════════════════════════════════════════ */
const GENRE_TO_CATEGORY: Record<string, string> = {
  // Tình cảm
  "Ngôn tình": "tinh-cam",
  "Đam mỹ": "tinh-cam",
  "LGBT+": "tinh-cam",
  "Bách hợp": "tinh-cam",
  "Thanh mai trúc mã": "tinh-cam",
  "Cưỡng chế yêu": "tinh-cam",
  "Sinh tử văn": "tinh-cam",
  "ABO": "tinh-cam",
  "Ngược tâm": "tinh-cam",
  "Ngược nhẹ": "tinh-cam",
  "Ngọt ngào": "tinh-cam",
  "Thuần ngọt": "tinh-cam",
  "Lãng mạn": "tinh-cam",
  "Tình cảm sâu sắc": "tinh-cam",
  "Drama tình cảm": "tinh-cam",
  "Quan hệ phức tạp": "tinh-cam",
  "1x1": "tinh-cam",
  "NP / Harem": "tinh-cam",
  "Không CP": "tinh-cam",

  // Huyền huyễn & Giả tưởng
  "Huyền huyễn": "gia-tuong-huyen-huyen",
  "Hiện đại kỳ ảo": "gia-tuong-huyen-huyen",
  "Dị giới": "gia-tuong-huyen-huyen",
  "Dị năng": "gia-tuong-huyen-huyen",
  "Tu tiên": "gia-tuong-huyen-huyen",
  "Thú nhân": "gia-tuong-huyen-huyen",
  "Thần thú": "gia-tuong-huyen-huyen",
  "Giả tưởng": "gia-tuong-huyen-huyen",
  "Giả Tưởng": "gia-tuong-huyen-huyen",

  // Khoa học viễn tưởng
  "Khoa học viễn tưởng": "khoa-hoc-tuong-lai",
  "Robot": "khoa-hoc-tuong-lai",
  "AI": "khoa-hoc-tuong-lai",
  "Tương lai": "khoa-hoc-tuong-lai",

  // Xuyên không & Trọng sinh
  "Xuyên không": "xuyen-khong",
  "Xuyên sách": "xuyen-khong",
  "Xuyên game": "xuyen-khong",
  "Xuyên nhanh": "xuyen-khong",
  "Trọng sinh": "xuyen-khong",
  "Trùng sinh": "xuyen-khong",
  "Hoán đổi linh hồn": "xuyen-khong",
  "Hệ thống": "xuyen-khong",

  // Kinh dị & Tâm linh
  "Kinh dị": "kinh-di-tam-linh",
  "Tâm linh": "kinh-di-tam-linh",
  "Minh hôn": "kinh-di-tam-linh",

  // Học đường & Đời thường
  "Học đường": "hoc-duong-do-thi",
  "Văn phòng công sở": "hoc-duong-do-thi",
  "Thương trường": "hoc-duong-do-thi",
  "Showbiz": "hoc-duong-do-thi",
  "Quân nhân": "hoc-duong-do-thi",
  "Hiện đại": "hoc-duong-do-thi",
  "Cổ đại": "hoc-duong-do-thi",
  "Tiền sử": "hoc-duong-do-thi",
  "Mạt thế": "hoc-duong-do-thi",
  "Tận thế": "hoc-duong-do-thi",
  "Chiến tranh": "hoc-duong-do-thi",
  "Việt Nam": "hoc-duong-do-thi",
  "Làm ruộng": "hoc-duong-do-thi",
  "Ẩm thực": "hoc-duong-do-thi",
  "Livestream": "hoc-duong-do-thi",
  "E-sport": "hoc-duong-do-thi",
  "Thể thao": "hoc-duong-do-thi",
  "Thế giới mạng": "hoc-duong-do-thi",

  // Tâm lý & Tội phạm
  "Tâm lý": "tam-ly-toi-pham",
  "Tâm lý tội phạm": "tam-ly-toi-pham",
  "Thế giới ngầm": "tam-ly-toi-pham",
  "Chữa lành": "tam-ly-toi-pham",

  // Fanfic & Light novel
  "Fanfic": "fanfic-light-novel",
  "Light novel": "fanfic-light-novel",
  "Oneshot": "fanfic-light-novel",
  "Truyện ngắn": "fanfic-light-novel",
  "Tiểu thuyết": "fanfic-light-novel",
  "Tự truyện": "fanfic-light-novel",
  "Tản văn": "fanfic-light-novel",

  // Ending, perspective — fallback to tinh-cam
  "Góc nhìn nữ chính": "tinh-cam",
  "Góc nhìn nam chính": "tinh-cam",
  "HE (Happy Ending)": "tinh-cam",
  "SE (Sad Ending)": "tinh-cam",
  "OE (Open Ending)": "tinh-cam",
  "BE (Bad Ending)": "tinh-cam",
  "GE (Good Ending)": "tinh-cam",
  "Miễn phí": "fanfic-light-novel",
  "Trả phí": "fanfic-light-novel",
};

/* Also map aliases & alternate names */
const GENRE_NAME_ALIAS: Record<string, string> = {
  "Trùng sinh": "Trọng sinh",
  "Giả Tưởng": "Huyền huyễn",
  "Giả tưởng": "Huyền huyễn",
};

/* ══════════════════════════════════════════════════
   4. OLD GENRE SLUG → NEW CATEGORY SLUG (Redirects)
   ══════════════════════════════════════════════════ */
const REDIRECT_MAP: Record<string, string> = {
  "/the-loai/ngon-tinh": "/the-loai/tinh-cam",
  "/the-loai/dam-my": "/the-loai/tinh-cam",
  "/the-loai/bach-hop": "/the-loai/tinh-cam",
  "/the-loai/ngot-sung": "/the-loai/tinh-cam",
  "/the-loai/tien-hiep": "/the-loai/gia-tuong-huyen-huyen",
  "/the-loai/huyen-huyen": "/the-loai/gia-tuong-huyen-huyen",
  "/the-loai/khoa-hoc-vien-tuong": "/the-loai/khoa-hoc-tuong-lai",
  "/the-loai/xuyen-khong": "/the-loai/xuyen-khong", // same slug — no redirect needed
  "/the-loai/trong-sinh": "/the-loai/xuyen-khong",
  "/the-loai/kinh-di": "/the-loai/kinh-di-tam-linh",
  "/the-loai/hoc-duong": "/the-loai/hoc-duong-do-thi",
  "/the-loai/co-dai": "/the-loai/hoc-duong-do-thi",
  "/the-loai/do-thi": "/the-loai/hoc-duong-do-thi",
  "/the-loai/mat-the": "/the-loai/hoc-duong-do-thi",
  "/the-loai/light-novel": "/the-loai/fanfic-light-novel",
  "/the-loai/fanfic": "/the-loai/fanfic-light-novel",
};

/* ══════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════ */
async function main() {
  console.log(`\n🏷  Category & Tag Migration ${isDryRun ? "(DRY RUN)" : "(EXECUTE)"}${isForce ? " [FORCE]" : ""}\n`);

  // ── Step 1: Seed categories ──
  console.log("─── Step 1: Seeding categories ───");
  const categoryMap: Record<string, string> = {}; // slug → id

  for (const cat of CATEGORIES) {
    const existing = await prisma.category.findUnique({ where: { slug: cat.slug } });
    if (existing) {
      categoryMap[cat.slug] = existing.id;
      console.log(`  ✓ Category "${cat.name}" already exists`);
    } else if (isDryRun) {
      console.log(`  [DRY] Would create category: ${cat.name} (${cat.slug})`);
    } else {
      const created = await prisma.category.create({ data: cat });
      categoryMap[cat.slug] = created.id;
      console.log(`  ✓ Created category: ${cat.name}`);
    }
  }

  // ── Step 2: Seed tags ──
  console.log("\n─── Step 2: Seeding tags ───");
  const tagMap: Record<string, string> = {}; // slug → id

  for (const tag of TAGS) {
    const existing = await prisma.tag.findUnique({ where: { slug: tag.slug } });
    if (existing) {
      tagMap[tag.slug] = existing.id;
      // Skip logging for brevity
    } else if (isDryRun) {
      console.log(`  [DRY] Would create tag: ${tag.name} (${tag.slug}, type=${tag.type})`);
    } else {
      const created = await prisma.tag.create({ data: tag });
      tagMap[tag.slug] = created.id;
      console.log(`  ✓ Created tag: ${tag.name}`);
    }
  }
  console.log(`  Total tags: ${TAGS.length}`);

  // If dry-run and no IDs yet, load them anyway for reporting
  if (isDryRun) {
    const allCats = await prisma.category.findMany();
    for (const c of allCats) categoryMap[c.slug] = c.id;
    const allTags = await prisma.tag.findMany();
    for (const t of allTags) tagMap[t.slug] = t.id;
  }

  // ── Step 3: Seed redirects ──
  console.log("\n─── Step 3: Seeding redirects ───");
  for (const [oldPath, newPath] of Object.entries(REDIRECT_MAP)) {
    if (oldPath === newPath) continue; // skip same-slug
    const existing = await prisma.redirect.findUnique({ where: { oldPath } });
    if (existing) {
      console.log(`  ✓ Redirect "${oldPath}" already exists`);
    } else if (isDryRun) {
      console.log(`  [DRY] Would create redirect: ${oldPath} → ${newPath}`);
    } else {
      await prisma.redirect.create({ data: { oldPath, newPath, code: 301 } });
      console.log(`  ✓ ${oldPath} → ${newPath}`);
    }
  }

  // ── Step 4: Migrate stories ──
  console.log("\n─── Step 4: Migrating stories ───");
  const stories = await prisma.story.findMany({
    select: { id: true, genre: true, tags: true, categoryId: true },
  });
  console.log(`  Total stories: ${stories.length}`);

  let assigned = 0;
  let tagged = 0;
  let skipped = 0;
  let unmapped: string[] = [];

  for (const story of stories) {
    // 4a: Assign categoryId
    const genre = story.genre?.trim();
    if (!genre) {
      skipped++;
      continue;
    }

    // Case-insensitive lookup: try exact match first, then case-insensitive
    let categorySlug = GENRE_TO_CATEGORY[genre];
    if (!categorySlug) {
      const lcGenre = genre.toLowerCase();
      const match = Object.entries(GENRE_TO_CATEGORY).find(
        ([k]) => k.toLowerCase() === lcGenre
      );
      if (match) categorySlug = match[1];
    }

    if (!categorySlug) {
      if (!unmapped.includes(genre)) unmapped.push(genre);
      // Fallback: assign to fanfic-light-novel
      if (!story.categoryId) {
        if (!isDryRun) {
          await prisma.story.update({
            where: { id: story.id },
            data: { categoryId: categoryMap["fanfic-light-novel"] || undefined },
          });
        }
        assigned++;
      }
      continue;
    }

    const catId = categoryMap[categorySlug];
    if (catId && (!story.categoryId || isForce)) {
      if (!isDryRun) {
        await prisma.story.update({
          where: { id: story.id },
          data: { categoryId: catId },
        });
      }
      assigned++;
    }

    // 4b: Create StoryTag for the genre
    const aliasedGenre = GENRE_NAME_ALIAS[genre] || genre;
    // Case-insensitive tag match
    const genreTag = TAGS.find((t) => t.name.toLowerCase() === aliasedGenre.toLowerCase());
    if (genreTag) {
      const tagId = tagMap[genreTag.slug];
      if (tagId) {
        const exists = await prisma.storyTag.findUnique({
          where: { storyId_tagId: { storyId: story.id, tagId } },
        });
        if (!exists) {
          if (!isDryRun) {
            await prisma.storyTag.create({ data: { storyId: story.id, tagId } });
          }
          tagged++;
        }
      }
    }

    // 4c: Create StoryTags for comma-separated tags field
    if (story.tags) {
      const tagNames = story.tags.split(",").map((t) => t.trim()).filter(Boolean);
      for (const tagName of tagNames) {
        const aliased = GENRE_NAME_ALIAS[tagName] || tagName;
        const tagDef = TAGS.find((t) => t.name.toLowerCase() === aliased.toLowerCase());
        if (tagDef) {
          const tagId = tagMap[tagDef.slug];
          if (tagId) {
            const exists = await prisma.storyTag.findUnique({
              where: { storyId_tagId: { storyId: story.id, tagId } },
            });
            if (!exists) {
              if (!isDryRun) {
                await prisma.storyTag.create({ data: { storyId: story.id, tagId } });
              }
              tagged++;
            }
          }
        }
      }
    }
  }

  console.log(`\n─── Summary ───`);
  console.log(`  Categories assigned: ${assigned}`);
  console.log(`  StoryTags created: ${tagged}`);
  console.log(`  Stories skipped (no genre): ${skipped}`);
  if (unmapped.length > 0) {
    console.log(`  ⚠ Unmapped genres (fallback → fanfic-light-novel):`);
    for (const g of unmapped) console.log(`    - "${g}"`);
  }

  if (isDryRun) {
    console.log(`\n📋 This was a DRY RUN. Run with --execute to apply changes.\n`);
  } else {
    console.log(`\n✅ Migration complete!\n`);
  }
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
