<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import SiteCopyright from './SiteCopyright.vue'

const { frontmatter } = useData()
</script>

<!-- The default layout, with the copyright under the content of every page. Doc pages put it
     inside the content column so the sidebar never covers it; the home page has no sidebar and
     puts it at the very bottom. -->
<template>
  <DefaultTheme.Layout>
    <template #doc-after><SiteCopyright class="site-copyright--doc" /></template>
    <template #page-bottom><SiteCopyright /></template>
    <template #layout-bottom>
      <SiteCopyright v-if="frontmatter.layout === 'home'" class="site-copyright--home" />
    </template>
  </DefaultTheme.Layout>
</template>
