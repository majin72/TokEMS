<script setup lang="ts">
const route = useRoute();
const api = useConferenceApi();
const failed = ref(false);

useHead({
  title: '正在进入大会报名',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
});

onMounted(async () => {
  try {
    const result = await api.resolvePartnerReferral(String(route.params.code ?? ''));
    window.location.replace(api.resolveConferenceUrl(result.destinationPath));
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <div class="referral-page">
    <FlowHeader />
    <main>
      <div class="referral-card">
        <span aria-hidden="true">G</span>
        <h1>{{ failed ? '推广链接已失效' : '正在记录推荐来源' }}</h1>
        <p>{{ failed ? '请返回大会主页选择报名入口。' : '即将进入大会报名页。' }}</p>
        <NuxtLink v-if="failed" to="/">返回大会主页</NuxtLink>
      </div>
    </main>
  </div>
</template>

<style scoped>
.referral-page{min-height:100vh;background:#f4f6f9}.referral-page main{display:grid;min-height:calc(100vh - 72px);place-items:center;padding:24px}.referral-card{width:min(100%,420px);padding:42px;border:1px solid #dfe5ee;border-radius:16px;background:#fff;box-shadow:0 16px 44px rgb(28 45 74/8%);text-align:center}.referral-card>span{display:grid;width:54px;height:54px;place-items:center;margin:auto;border-radius:14px;background:#1f5fe8;color:#fff;font-weight:800}.referral-card h1{margin:20px 0 8px;color:#172033;font-size:26px}.referral-card p{color:#6c788a}.referral-card a{display:inline-flex;margin-top:18px;padding:11px 18px;border-radius:8px;background:#1f5fe8;color:#fff;font-weight:700}
</style>
