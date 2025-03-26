const checkGroupMembership = async (ctx) => {
  try {
    const userId = ctx.from.id;
    const groupId = process.env.GROUP_ID;
    
    const memberInfo = await ctx.telegram.getChatMember(groupId, userId);
    
    // Statuses: creator, administrator, member, restricted, left, kicked
    return ['creator', 'administrator', 'member', 'restricted'].includes(memberInfo.status);
  } catch (error) {
    console.error('Error checking group membership:', error);
    return false;
  }
};

module.exports = {
  checkGroupMembership,
};