const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p.story.findMany({
  where: { coverImage: { not: null } },
  take: 5,
  select: { id: true, title: true, coverImage: true, approvalStatus: true, coverApprovalStatus: true }
}).then(s => {
  console.log('Stories with coverImage:', s.length);
  s.forEach(story => {
    console.log('-', story.title, '| approval:', story.approvalStatus, '| coverStatus:', story.coverApprovalStatus);
    console.log('  coverImage starts:', story.coverImage ? story.coverImage.substring(0, 50) : 'null');
  });
  p.$disconnect();
}).catch(e => { console.error(e); p.$disconnect(); });
