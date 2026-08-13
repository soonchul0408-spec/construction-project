import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/regional-industry',
      name: 'regional-industry',
      component: () => import('../views/RegionalIndustryView.vue'),
    },
    {
      path: '/regional-industry/:id',
      name: 'regional-industry-detail',
      component: () => import('../views/RegionalIndustryDetailView.vue'),
    },
    {
      path: '/legislation',
      name: 'legislation',
      component: () => import('../views/LegislationView.vue'),
    },
    {
      path: '/my-analysis',
      name: 'my-analysis',
      component: () => import('../views/MyAnalysisView.vue'),
    },
    {
      path: '/about',
      name: 'about',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/AboutView.vue'),
    },
  ],
})

export default router
