<script setup lang="ts">
import { useNuxtData } from '#app';
import type { PublicSiteConfiguration } from '@conference/contracts';

const route = useRoute();
const { data: siteConfiguration } = useNuxtData<PublicSiteConfiguration>(
  'public-site-configuration',
);
const eventSlug = computed(() => String(route.query.event ?? ''));
const homeHref = computed(() =>
  eventSlug.value ? `/?event=${encodeURIComponent(eventSlug.value)}` : '/',
);
</script>

<template>
  <header class="flow-header">
    <div class="flow-header__inner">
      <NuxtLink class="flow-brand" :to="homeHref">
        <span class="flow-brand__mark">G</span>
        <span>{{ siteConfiguration?.website.siteName ?? '大会报名中心' }}</span>
      </NuxtLink>
      <div class="flow-header__actions">
        <span class="flow-header__meta">安全报名通道 · 信息加密传输</span>
        <CustomerAccountAction />
      </div>
    </div>
  </header>
</template>

<style scoped>
.flow-header__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
@media (max-width: 640px) {
  .flow-header__meta {
    display: none;
  }
  .flow-header__inner {
    width: min(100% - 28px, 1160px);
  }
}
</style>
