/**
 * Seed Tags & Categories for VStory
 * Run: node seed_tags.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ─── Categories (Danh mục lớn cho SEO + navigation) ──────────
const categories = [
  { name: "Tình cảm", icon: "💕", color: "#ec4899", order: 1 },
  { name: "Huyền huyễn & Giả tưởng", icon: "🔮", color: "#8b5cf6", order: 2 },
  { name: "Xuyên không & Chuyển sinh", icon: "🌀", color: "#6366f1", order: 3 },
  { name: "Học đường & Đời thường", icon: "🏫", color: "#3b82f6", order: 4 },
  { name: "Kinh dị & Linh dị", icon: "👻", color: "#1e293b", order: 5 },
  { name: "Đam mỹ", icon: "🌈", color: "#0ea5e9", order: 6 },
  { name: "Bách hợp", icon: "🌸", color: "#f472b6", order: 7 },
  { name: "Phiêu lưu & Hành động", icon: "⚔️", color: "#ef4444", order: 8 },
  { name: "Ngôn tình", icon: "❤️", color: "#f43f5e", order: 9 },
  { name: "Light Novel & Fanfic", icon: "📚", color: "#f59e0b", order: 10 },
  { name: "Khoa học viễn tưởng", icon: "🚀", color: "#06b6d4", order: 11 },
  { name: "Cổ đại & Kiếm hiệp", icon: "🏯", color: "#84cc16", order: 12 },
];

// ─── Tags (Thẻ tag chi tiết) ──────────────────────
const tags = [
  // genre — Thể loại chính
  { name: "Ngôn tình", type: "genre" },
  { name: "Đam mỹ", type: "genre" },
  { name: "Bách hợp", type: "genre" },
  { name: "LGBT+", type: "genre" },
  { name: "ABO", type: "genre" },
  { name: "Huyền huyễn", type: "genre" },
  { name: "Tu tiên", type: "genre" },
  { name: "Kinh dị", type: "genre" },
  { name: "Khoa học viễn tưởng", type: "genre" },
  { name: "Tâm lý tội phạm", type: "genre" },
  { name: "Trinh thám", type: "genre" },
  { name: "Hài hước", type: "genre" },
  { name: "Phiêu lưu", type: "genre" },
  { name: "Võng du", type: "genre" },
  { name: "Thể thao", type: "genre" },
  { name: "E-sport", type: "genre" },
  { name: "Ẩm thực", type: "genre" },
  { name: "Làm ruộng", type: "genre" },

  // setting — Bối cảnh
  { name: "Cổ đại", type: "setting" },
  { name: "Hiện đại", type: "setting" },
  { name: "Học đường", type: "setting" },
  { name: "Thương trường", type: "setting" },
  { name: "Văn phòng công sở", type: "setting" },
  { name: "Quân nhân", type: "setting" },
  { name: "Showbiz", type: "setting" },
  { name: "Mạt thế", type: "setting" },
  { name: "Dị giới", type: "setting" },
  { name: "Tiên giới", type: "setting" },
  { name: "Ma giới", type: "setting" },
  { name: "Hậu cung", type: "setting" },
  { name: "Giang hồ", type: "setting" },
  { name: "Đô thị", type: "setting" },
  { name: "Nông thôn", type: "setting" },

  // tone — Phong cách
  { name: "Ngọt ngào", type: "tone" },
  { name: "Thuần ngọt", type: "tone" },
  { name: "Ngược tâm", type: "tone" },
  { name: "Chữa lành", type: "tone" },
  { name: "Sủng", type: "tone" },
  { name: "Nhẹ nhàng", type: "tone" },
  { name: "Nặng", type: "tone" },
  { name: "Hài", type: "tone" },
  { name: "Bi kịch", type: "tone" },
  { name: "Kịch tính", type: "tone" },
  { name: "Nghiêm túc", type: "tone" },
  { name: "Thanh thủy văn", type: "tone" },
  { name: "Darkfic", type: "tone" },

  // relation — Quan hệ
  { name: "1x1", type: "relation" },
  { name: "Harem", type: "relation" },
  { name: "Reverse harem", type: "relation" },
  { name: "Tổng thụ", type: "relation" },
  { name: "Tổng công", type: "relation" },
  { name: "Niên hạ", type: "relation" },
  { name: "Niên thượng", type: "relation" },
  { name: "Song luồng", type: "relation" },
  { name: "Oan gia", type: "relation" },
  { name: "Mai mối", type: "relation" },
  { name: "Hôn nhân hợp đồng", type: "relation" },
  { name: "Thanh mai trúc mã", type: "relation" },

  // ending — Kết cục
  { name: "HE (Happy Ending)", type: "ending" },
  { name: "BE (Bad Ending)", type: "ending" },
  { name: "SE (Sad Ending)", type: "ending" },
  { name: "OE (Open Ending)", type: "ending" },

  // perspective — Góc nhìn
  { name: "Nữ chính", type: "perspective" },
  { name: "Nam chính", type: "perspective" },
  { name: "Xưng tôi", type: "perspective" },
  { name: "Ngôi thứ ba", type: "perspective" },
  { name: "Đa góc nhìn", type: "perspective" },

  // content — Nội dung đặc biệt
  { name: "Xuyên không", type: "content" },
  { name: "Xuyên sách", type: "content" },
  { name: "Xuyên game", type: "content" },
  { name: "Xuyên nhanh", type: "content" },
  { name: "Trọng sinh", type: "content" },
  { name: "Trùng sinh", type: "content" },
  { name: "Hệ thống", type: "content" },
  { name: "Hoán đổi linh hồn", type: "content" },
  { name: "Cung đấu", type: "content" },
  { name: "Trạch đấu", type: "content" },
  { name: "Báo thù", type: "content" },
  { name: "Giả trai", type: "content" },
  { name: "Nữ giả nam", type: "content" },
  { name: "Nam giả nữ", type: "content" },
  { name: "Dị năng", type: "content" },
  { name: "Tâm linh", type: "content" },
  { name: "Hiện đại kỳ ảo", type: "content" },

  // form — Hình thức
  { name: "Light novel", type: "form" },
  { name: "Web novel", type: "form" },
  { name: "Fanfic", type: "form" },
  { name: "Oneshot", type: "form" },
  { name: "Truyện ngắn", type: "form" },
  { name: "Truyện sáng tác", type: "form" },
  { name: "Truyện dịch", type: "form" },
];

async function seedCategories() {
  console.log("\n📂 Seeding categories...");
  let created = 0, skipped = 0;

  for (const cat of categories) {
    const slug = slugify(cat.name);
    const exists = await prisma.category.findUnique({ where: { slug } });
    if (exists) {
      skipped++;
      continue;
    }
    await prisma.category.create({
      data: {
        name: cat.name,
        slug,
        icon: cat.icon,
        color: cat.color,
        displayOrder: cat.order,
      },
    });
    created++;
  }
  console.log(`   ✅ Created: ${created}, Skipped: ${skipped}`);
}

async function seedTags() {
  console.log("\n🏷️  Seeding tags...");

  const existingTags = await prisma.tag.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existingTags.map((t) => t.slug));

  const newTags = [];
  let skipped = 0;

  for (const tag of tags) {
    // Append type to slug to avoid collisions between categories
    const baseSlug = slugify(tag.name);
    // Use type-prefixed slug only if base slug already used by a different type
    let slug = baseSlug;
    const duplicate = newTags.find((t) => t.slug === slug);
    if (duplicate) {
      slug = `${baseSlug}-${tag.type}`;
    }

    if (existingSlugs.has(slug)) {
      skipped++;
      continue;
    }
    existingSlugs.add(slug);
    newTags.push({ name: tag.name, slug, type: tag.type });
  }

  if (newTags.length > 0) {
    const result = await prisma.tag.createMany({
      data: newTags,
      skipDuplicates: true,
    });
    console.log(`   ✅ Created: ${result.count}, Skipped: ${skipped}`);
  } else {
    console.log(`   ✅ Created: 0, Skipped: ${skipped} (all exist)`);
  }
}

async function main() {
  console.log("🌱 VStory Tag & Category Seeder");
  console.log("================================");

  await seedCategories();
  await seedTags();

  // Summary
  const catCount = await prisma.category.count();
  const tagCount = await prisma.tag.count();
  console.log(`\n📊 Database now has: ${catCount} categories, ${tagCount} tags`);
  console.log("✅ Done!\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
