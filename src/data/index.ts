import type { HealthGateway, MaterialsGateway, CraftGateway, ProjectsGateway, ExperienceGateway } from './contracts'
import { readEnvironment } from './environment'
import { mockHealthGateway } from './mock/health'

export async function getHealthGateway(): Promise<HealthGateway> {
  if (readEnvironment(import.meta.env).VITE_DATA_MODE === 'mock') return mockHealthGateway
  return (await import('./firebase/health')).firebaseHealthGateway
}

let craftGateway: Promise<CraftGateway> | undefined
export function getCraftGateway(): Promise<CraftGateway> {
  craftGateway ??= (async () => {
    if (readEnvironment(import.meta.env).VITE_DATA_MODE === 'mock') return (await import('./mock/crafts')).getMockCraftGateway()
    return (await import('./firebase/crafts')).firebaseCraftGateway
  })().catch((error: unknown) => { craftGateway = undefined; throw error })
  return craftGateway
}

let materialsGateway: Promise<MaterialsGateway> | undefined
export function getMaterialsGateway(): Promise<MaterialsGateway> {
  materialsGateway ??= (async () => {
    if (readEnvironment(import.meta.env).VITE_DATA_MODE === 'mock') return (await import('./mock/materials')).getMockMaterialsGateway()
    return (await import('./firebase/materials')).firebaseMaterialsGateway
  })().catch((error: unknown) => { materialsGateway = undefined; throw error })
  return materialsGateway
}

let projectsGateway: Promise<ProjectsGateway> | undefined
export function getProjectsGateway(): Promise<ProjectsGateway> {
  projectsGateway ??= (async () => {
    if (readEnvironment(import.meta.env).VITE_DATA_MODE === 'mock') return (await import('./mock/projects')).getMockProjectsGateway()
    return (await import('./firebase/projects')).firebaseProjectsGateway
  })().catch((error: unknown) => { projectsGateway = undefined; throw error })
  return projectsGateway
}

let experienceGateway: Promise<ExperienceGateway> | undefined
export function getExperienceGateway(): Promise<ExperienceGateway> {
  experienceGateway ??= (async () => {
    if (readEnvironment(import.meta.env).VITE_DATA_MODE === 'mock') return (await import('./mock/experience')).getMockExperienceGateway()
    return (await import('./firebase/experience')).firebaseExperienceGateway
  })().catch((error: unknown) => { experienceGateway = undefined; throw error })
  return experienceGateway
}
