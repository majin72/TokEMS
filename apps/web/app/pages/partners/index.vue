<script setup lang="ts">
import { useAsyncData } from '#imports';
import { publicEventHomePath } from '@conference/contracts';

const route = useRoute();
const api = useConferenceApi();
const eventSlug = computed(() => String(route.query.event ?? api.eventState.value.slug ?? ''));
const { data, error } = await useAsyncData(
  () => `event-partners:${eventSlug.value}`,
  () => api.getEventPartners(eventSlug.value, 100),
  { watch: [eventSlug] },
);

useHead(() => ({
  title: `合作伙伴·${api.eventState.value.name}`,
  meta: [{ name: 'description', content: '认识与大会同行的合作伙伴，查看他们的专业背景与合作方向。' }],
}));
</script>

<template>
  <div class="partners-page">
    <FlowHeader />
    <main id="main-content" class="partners-shell">
      <NuxtLink class="partners-back" :to="publicEventHomePath(eventSlug)">← 返回大会主页</NuxtLink>
      <header class="partners-head">
        <p>EVENT PARTNERS</p>
        <h1>大会合作伙伴</h1>
        <span>他们用专业经验、行业资源和真实连接，与大会共同推动更多高质量合作。</span>
      </header>
      <p v-if="error" class="partners-state">合作伙伴目录暂未开放。</p>
      <section v-else-if="data?.items.length" class="partner-grid" aria-label="合作伙伴列表">
        <NuxtLink
          v-for="item in data.items"
          :key="item.publicSlug"
          class="partner-card"
          :to="`/partners/${encodeURIComponent(item.publicSlug)}?event=${encodeURIComponent(eventSlug)}`"
        >
          <div class="partner-avatar">
            <img v-if="item.avatarUrl" :src="item.avatarUrl" :alt="`${item.displayName}的头像`" />
            <span v-else>{{ item.displayName.slice(0, 1) }}</span>
          </div>
          <div>
            <p>{{ item.industry || 'PARTNER' }}</p>
            <h2>{{ item.displayName }}</h2>
            <strong>{{ [item.company, item.title].filter(Boolean).join(' · ') }}</strong>
            <span>{{ item.businessIntro || '查看合作伙伴详情与推广入口' }}</span>
          </div>
          <b aria-hidden="true">↗</b>
        </NuxtLink>
      </section>
      <p v-else class="partners-state">当前大会还没有公开合作伙伴。</p>
    </main>
  </div>
</template>

<style scoped>
.partners-page{min-height:100vh;background:#f4f6f9}.partners-shell{width:min(100% - 40px,1080px);margin:auto;padding:28px 0 70px}.partners-back{display:inline-flex;margin-bottom:22px;color:#657186;font-size:13px}.partners-head{max-width:720px;margin:12px 0 34px}.partners-head p,.partner-card p{margin:0;color:#1f5fe8;font:750 10px var(--conference-font-mono);letter-spacing:.12em}.partners-head h1{margin:8px 0 12px;color:#172033;font-size:clamp(40px,6vw,64px);letter-spacing:-.05em;line-height:1.05}.partners-head span{color:#566276;line-height:1.8}.partner-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.partner-card{position:relative;display:grid;grid-template-columns:104px 1fr;gap:22px;min-height:150px;padding:24px;border:1px solid #dfe5ee;border-radius:14px;background:#fff;box-shadow:0 12px 34px rgb(28 45 74/6%);color:inherit;transition:transform .16s ease,border-color .16s ease}.partner-card:hover{transform:translateY(-2px);border-color:#aebfda}.partner-avatar{display:grid;width:104px;height:104px;place-items:center;overflow:hidden;border-radius:12px;background:#e8efff;color:#1f5fe8;font-size:32px;font-weight:800}.partner-avatar img{width:100%;height:100%;object-fit:cover}.partner-card h2{margin:7px 0 4px;color:#172033;font-size:24px}.partner-card strong{display:block;color:#435269;font-size:13px}.partner-card div>span{display:-webkit-box;margin-top:12px;overflow:hidden;color:#6a7688;font-size:13px;line-height:1.65;-webkit-line-clamp:2;-webkit-box-orient:vertical}.partner-card b{position:absolute;right:18px;top:16px;color:#8ca0bb}.partners-state{padding:80px 20px;border:1px solid #dfe5ee;border-radius:14px;background:#fff;color:#6d788a;text-align:center}@media(max-width:760px){.partners-shell{width:min(100% - 24px,680px);padding-top:18px}.partner-grid{grid-template-columns:1fr}.partner-card{grid-template-columns:78px 1fr;padding:18px;gap:16px}.partner-avatar{width:78px;height:78px}.partners-head{margin-bottom:24px}.partners-head h1{font-size:40px}}
</style>
