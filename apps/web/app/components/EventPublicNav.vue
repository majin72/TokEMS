<script setup lang="ts">
import { publicEventHomePath, publicEventScopedPath } from '@conference/contracts';

const props = withDefaults(
  defineProps<{
    eventSlug: string;
    eventName?: string;
  }>(),
  { eventName: '' },
);

const homePath = computed(() => {
  try {
    return publicEventHomePath(props.eventSlug);
  } catch {
    return '/';
  }
});
const registrationPath = computed(() => {
  try {
    return publicEventScopedPath('/register', props.eventSlug);
  } catch {
    return '/register';
  }
});
const faqPath = computed(() => {
  try {
    return publicEventScopedPath('/faq', props.eventSlug);
  } catch {
    return '/faq';
  }
});
</script>

<template>
  <nav id="nav" class="event-public-nav scrolled" aria-label="大会主导航">
    <div class="nav-inner">
      <a :href="`${homePath}#hero`" class="logo" aria-label="返回大会首页">
        <span class="logo-mark">G</span>
        <span class="event-public-nav__brand">GEO大会</span>
        <span v-if="eventName" class="logo-sub">{{ eventName }}</span>
      </a>
      <div class="nav-links">
        <a :href="`${homePath}#why`">背景</a>
        <a :href="`${homePath}#agenda`">议程</a>
        <a :href="`${homePath}#speakers`">嘉宾</a>
        <a :href="`${homePath}#members`">会员</a>
        <a class="is-current" :href="`${homePath}#event-partners`" aria-current="page">
          合作伙伴
        </a>
        <a :href="`${homePath}#tickets`">门票</a>
        <a :href="faqPath">FAQ</a>
      </div>
      <div class="nav-cta">
        <a :href="registrationPath" class="btn btn-primary">立即报名</a>
        <CustomerAccountAction />
      </div>
    </div>
  </nav>
  <div class="event-public-nav__spacer" aria-hidden="true"></div>
</template>

<style scoped>
.event-public-nav {
  box-sizing: border-box;
}
.event-public-nav__brand {
  flex: 0 0 auto;
}
.event-public-nav .logo-sub {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.event-public-nav .nav-links a.is-current {
  border-color: rgb(31 95 232 / 16%);
  background: #edf3ff;
  color: #1f5fe8;
}
.event-public-nav__spacer {
  height: 69px;
}
@media (max-width: 640px) {
  .event-public-nav__spacer {
    height: 64px;
  }
}
</style>
