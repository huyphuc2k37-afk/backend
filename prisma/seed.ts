import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ─── Authors ──────────────────────────────────
  const author1 = await prisma.user.upsert({
    where: { email: "nguyenvana@gmail.com" },
    update: {},
    create: {
      name: "Nguyễn Văn A",
      email: "nguyenvana@gmail.com",
      image: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100",
      role: "author",
      bio: "Tác giả tiên hiệp hàng đầu Việt Nam với hơn 5 năm kinh nghiệm viết truyện.",
    },
  });

  const author2 = await prisma.user.upsert({
    where: { email: "tranthib@gmail.com" },
    update: {},
    create: {
      name: "Trần Thị B",
      email: "tranthib@gmail.com",
      image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100",
      role: "author",
      bio: "Chuyên viết ngôn tình, đô thị. Tác phẩm luôn nằm trong top trending.",
    },
  });

  const author3 = await prisma.user.upsert({
    where: { email: "lequangc@gmail.com" },
    update: {},
    create: {
      name: "Lê Quang C",
      email: "lequangc@gmail.com",
      image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100",
      role: "author",
      bio: "Tác giả huyền huyễn, kiếm hiệp. Fan trung thành của Kim Dung.",
    },
  });

  // ─── Stories ──────────────────────────────────
  const stories = [
    {
      title: "Phàm Nhân Tu Tiên",
      slug: "phan-nhan-tu-tien",
      description:
        "Một thiếu niên bình thường bước vào con đường tu tiên, từ phàm nhân vươn lên đỉnh cao Tiên giới. Hành trình đầy gian nan nhưng cũng không thiếu những cơ duyên kỳ diệu. Liệu hắn có thể phá vỡ giới hạn phàm nhân để vươn tới cõi trường sinh bất lão?",
      coverImage: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500",
      genre: "Tiên hiệp",
      status: "ongoing",
      tags: "tu tiên,phàm nhân,tiên giới,tu luyện",
      views: 125000,
      likes: 8900,
      authorId: author1.id,
    },
    {
      title: "Đấu Phá Thương Khung",
      slug: "dau-pha-thuong-khung",
      description:
        "Tiêu Viêm, một thiên tài sa cơ lỡ vận, từ đỉnh cao thiên tài rơi xuống vực thẳm. Nhưng với ý chí kiên cường và sự trợ giúp từ Dược Lão bí ẩn, hắn sẽ vùng dậy và chinh phục đỉnh cao mới. Tam thập niên hà đông, tam thập niên hà tây!",
      coverImage: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500",
      genre: "Huyền huyễn",
      status: "completed",
      tags: "huyền huyễn,đấu khí,luyện đan,chiến đấu",
      views: 230000,
      likes: 15600,
      authorId: author3.id,
    },
    {
      title: "Yêu Em Từ Cái Nhìn Đầu Tiên",
      slug: "yeu-em-tu-cai-nhin-dau-tien",
      description:
        "Câu chuyện tình yêu lãng mạn giữa Tiêu Nại — vị giáo sư trẻ thiên tài ngành khoa học máy tính, và Bối Vi Vi — cô sinh viên năm cuối xinh đẹp. Một mối tình trong sáng, nhẹ nhàng nhưng đầy ngọt ngào.",
      coverImage: "https://images.unsplash.com/photo-1474552226712-ac0f0961a954?w=500",
      genre: "Ngôn tình",
      status: "completed",
      tags: "ngôn tình,lãng mạn,đại học,ngọt sủng",
      views: 180000,
      likes: 12300,
      authorId: author2.id,
    },
    {
      title: "Kiếm Lai",
      slug: "kiem-lai",
      description:
        "Đại Thiên thế giới, vạn tộc lâm lập. Một thiếu niên từ thế giới bình phàm xuyên không đến, tay cầm ba thước thanh phong, cưỡi kiếm mà đi. Kiếm khí dọc ngang tam vạn dặm, một kiếm quang hàn mười chín châu.",
      coverImage: "https://images.unsplash.com/photo-1571757767119-68b8dbed8c97?w=500",
      genre: "Kiếm hiệp",
      status: "ongoing",
      tags: "kiếm hiệp,kiếm đạo,xuyên không,giang hồ",
      views: 95000,
      likes: 7200,
      authorId: author3.id,
    },
    {
      title: "Toàn Chức Cao Thủ",
      slug: "toan-chuc-cao-thu",
      description:
        "Vinh Diệu — vua game online thế hệ đầu, bị buộc phải rời đội tuyển chuyên nghiệp. Bắt đầu lại từ con số không tại quán net nhỏ, hắn sẽ chứng minh rằng Vinh Diệu chưa bao giờ lỗi thời. Hành trình trở lại đỉnh vinh quang bắt đầu!",
      coverImage: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500",
      genre: "Game",
      status: "completed",
      tags: "game,esport,trở lại,hệ thống",
      views: 156000,
      likes: 10500,
      authorId: author1.id,
    },
    {
      title: "Thương Gia Trùng Sinh",
      slug: "thuong-gia-trung-sinh",
      description:
        "Lâm Uyên, nữ tổng giám đốc công ty thời trang triệu đô, bất ngờ trùng sinh về 10 năm trước. Với kiến thức từ tương lai và trải nghiệm kinh doanh, cô quyết tâm thay đổi vận mệnh và bảo vệ những người cô yêu thương.",
      coverImage: "https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=500",
      genre: "Đô thị",
      status: "ongoing",
      tags: "đô thị,trùng sinh,nữ chính,kinh doanh",
      views: 78000,
      likes: 5600,
      authorId: author2.id,
    },
    {
      title: "Ma Thần Ký",
      slug: "ma-than-ky",
      description:
        "Thế giới nơi Ma và Thần cùng tồn tại. Lục Minh, một cậu bé mồ côi nhặt được cuốn sách cổ bí ẩn, từ đó bước chân vào thế giới tu luyện đầy nguy hiểm nhưng cũng không kém phần kỳ diệu. Con đường trở thành Ma Thần bắt đầu.",
      coverImage: "https://images.unsplash.com/photo-1500964757637-c85e8a162699?w=500",
      genre: "Huyền huyễn",
      status: "ongoing",
      tags: "huyền huyễn,ma thần,tu luyện,phiêu lưu",
      views: 67000,
      likes: 4800,
      authorId: author1.id,
    },
    {
      title: "Thiên Định Lương Duyên",
      slug: "thien-dinh-luong-duyen",
      description:
        "Cổ Vân Sơ, cô gái hiện đại xuyên không về thời cổ đại, trở thành con gái quan gia bị hắt hủi. Bằng trí thông minh và sự kiên cường, cô từng bước thay đổi số phận, bất ngờ vướng vào mối tình duyên với vị tướng quân lạnh lùng nhất triều đình.",
      coverImage: "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=500",
      genre: "Xuyên không",
      status: "completed",
      tags: "xuyên không,cổ đại,nữ chính,cung đấu",
      views: 143000,
      likes: 11200,
      authorId: author2.id,
    },
  ];

  for (const story of stories) {
    const created = await prisma.story.upsert({
      where: { slug: story.slug },
      update: {},
      create: story,
    });

    // Create chapters for each story
    const chapterCount = story.status === "completed" ? 8 : 5;
    for (let i = 1; i <= chapterCount; i++) {
      await prisma.chapter.upsert({
        where: {
          storyId_number: { storyId: created.id, number: i },
        },
        update: {},
        create: {
          title: `Chương ${i}: ${getChapterTitle(story.genre, i)}`,
          number: i,
          content: generateChapterContent(story.title, i, story.genre),
          wordCount: 2000 + Math.floor(Math.random() * 3000),
          storyId: created.id,
        },
      });
    }
  }

  console.log("✅ Seed completed!");
}

function getChapterTitle(genre: string, num: number): string {
  const titles: Record<string, string[]> = {
    "Tiên hiệp": ["Bước vào tu tiên", "Luyện khí kỳ", "Trúc Cơ thành công", "Kết Đan đại hội", "Kim Đan kỳ", "Nguyên Anh kỳ", "Hóa Thần", "Đại Thừa"],
    "Huyền huyễn": ["Thiên tài sa cơ", "Gặp kỳ duyên", "Bắt đầu tu luyện", "Đột phá cảnh giới", "Đại chiến", "Thăng cấp thần tốc", "Quyết chiến đỉnh phong", "Xưng bá thiên hạ"],
    "Ngôn tình": ["Cuộc gặp gỡ", "Rung động đầu đời", "Hiểu lầm", "Hẹn hò bí mật", "Thử thách tình yêu", "Tỏ tình", "Khoảng cách", "Hạnh phúc viên mãn"],
    "Kiếm hiệp": ["Nhập môn", "Học kiếm", "Hạ sơn", "Giang hồ hiểm ác", "Kết bạn", "Đại hội võ lâm", "Trận chiến sinh tử", "Đỉnh phong kiếm đạo"],
    "Game": ["Bắt đầu lại", "Tạo nhân vật mới", "Kỹ năng ẩn", "Đội hình huyền thoại", "Giải đấu khu vực", "Bán kết kịch tính", "Chung kết quốc gia", "Vinh quang trở lại"],
    "Đô thị": ["Trùng sinh", "Kế hoạch mới", "Đầu tư đầu tiên", "Đối thủ xuất hiện", "Thương trường khốc liệt", "Liên minh", "Đỉnh cao sự nghiệp", "Viên mãn"],
    "Xuyên không": ["Xuyên không", "Thích nghi", "Mưu kế", "Âm mưu cung đình", "Kết đồng minh", "Đại chiến", "Phản công", "Kết cục hoàn mỹ"],
  };
  const genreTitles = titles[genre] || titles["Huyền huyễn"];
  return genreTitles[(num - 1) % genreTitles.length];
}

function generateChapterContent(storyTitle: string, num: number, genre: string): string {
  const paragraphs = [];
  const intro = `Đây là chương ${num} trong bộ truyện "${storyTitle}".`;
  paragraphs.push(intro);

  const templates = [
    `Ánh nắng ban mai xuyên qua kẽ lá, rọi xuống con đường mòn dẫn vào rừng sâu. Nhân vật chính đứng lặng, suy ngẫm về những gì đã xảy ra trong những ngày qua. Mỗi bước đi là một lựa chọn, mỗi lựa chọn dẫn đến một vận mệnh khác nhau.`,
    `Gió thổi mạnh, cuốn theo những chiếc lá vàng bay tứ tán. Bầu trời u ám như báo hiệu một trận chiến sắp đến. Nhưng trong lòng hắn, ngọn lửa quyết tâm chưa bao giờ tắt.`,
    `"Ngươi nghĩ ngươi có thể đánh bại ta sao?" Giọng nói lạnh lẽo vang lên trong bóng tối. Nhân vật chính nắm chặt vũ khí trong tay, ánh mắt kiên định. "Ta sẽ không bao giờ lùi bước."`,
    `Đêm thanh tĩnh, chỉ có tiếng gió vi vu và tiếng côn trùng rả rích. Hắn ngồi xếp bằng dưới ánh trăng, hít thở sâu, cảm nhận nguồn năng lượng huyền bí đang chảy trong cơ thể. Từng chút, từng chút một, hắn cảm thấy mình mạnh mẽ hơn.`,
    `Bước vào thị trấn nhỏ, nhân vật chính được chào đón bởi những ánh mắt tò mò. Đây là nơi hắn chưa từng đặt chân đến, nhưng linh cảm mách bảo rằng nơi đây ẩn chứa điều gì đó quan trọng cho cuộc hành trình phía trước.`,
    `Trận chiến kết thúc, nhưng chiến thắng không mang lại niềm vui. Nhìn bạn đồng hành bị thương, hắn tự nhủ phải trở nên mạnh mẽ hơn nữa. Không để ai phải chịu đau khổ vì sự yếu đuối của mình.`,
    `Cuốn sách cổ phát ra ánh sáng rực rỡ. Từng dòng chữ hiện ra, mang theo tri thức từ ngàn năm trước. Hắn như nuốt lấy từng con chữ, cảm nhận sức mạnh cổ xưa đang thức tỉnh trong cơ thể.`,
    `"Con đường tu luyện không bao giờ dễ dàng," sư phụ nói, giọng ấm áp nhưng nghiêm túc. "Nhưng ta tin vào tiềm năng của con. Hãy nhớ, kiên trì là chìa khóa của mọi thành công."`,
  ];

  // Add 6-10 paragraphs
  const count = 6 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    paragraphs.push(templates[i % templates.length]);
  }

  paragraphs.push(`\nHết chương ${num}. Mời đọc giả đón đọc chương tiếp theo.`);
  return paragraphs.join("\n\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
