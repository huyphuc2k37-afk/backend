// Debug script: list pending deposits + simulate callback logic
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const deposits = await p.deposit.findMany({
      where: { status: 'pending' },
      select: {
        id: true,
        status: true,
        amount: true,
        coins: true,
        method: true,
        createdAt: true,
        userId: true,
        transferCode: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    console.log('=== PENDING DEPOSITS ===');
    console.log(JSON.stringify(deposits, null, 2));

    const withdrawals = await p.withdrawal.findMany({
      where: { status: 'pending' },
      select: {
        id: true,
        status: true,
        amount: true,
        moneyAmount: true,
        createdAt: true,
        userId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    console.log('=== PENDING WITHDRAWALS ===');
    console.log(JSON.stringify(withdrawals, null, 2));

    // Test if Prisma can find a real record by id
    if (deposits.length > 0) {
      const testId = deposits[0].id;
      console.log(`=== Testing findUnique with id="${testId}" ===`);
      const result = await p.deposit.findUnique({ where: { id: testId } });
      console.log('Found:', !!result, result ? `(status=${result.status})` : 'NULL');
    }

    // CUID regex sanity check
    const CUID_PATTERN = /^[a-z0-9]{20,32}$/i;
    if (deposits.length > 0) {
      const id = deposits[0].id;
      console.log(`=== CUID regex test ===`);
      console.log(`id="${id}" length=${id.length} passes=${CUID_PATTERN.test(id)}`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('STACK:', e.stack);
  } finally {
    await p.$disconnect();
  }
})();
