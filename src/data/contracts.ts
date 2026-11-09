import type { CandidatesDocument, Template, ConfirmMaterialsInput, EditMaterialsInput, MaterialsDocument, MaterialRecognitionResponse, RecognizeMaterialsInput, HealthResponse, CreateCraftInput, CraftSnapshot, GatewayError } from '@rekt/shared'
import type { GenerateProjectsInput, TranslateProjectsInput, ProductionDocument, StartCraftInput, CompleteStepInput, CompleteCraftInput, ProductionSnapshot, CompletionSnapshot, GalleryPost, GalleryPage, ListGalleryPageInput, PublishCraftInput, GalleryActionInput, CraftHistoryItem } from '@rekt/shared'

export interface HealthGateway { check(): Promise<HealthResponse> }
export interface CraftGateway {
  getUserId(): Promise<string>
  createCraft(input: CreateCraftInput): Promise<CraftSnapshot>
  subscribeToCraft(craftId: string, next: (snapshot: CraftSnapshot) => void, error: (error: GatewayError) => void): () => void
}
export interface MaterialsGateway {
  uploadMaterialPhoto(input: { craftId: string; photoId: string; blob: Blob }): Promise<{ imagePath: string; imageGeneration: string }>
  recognizeMaterials(input: RecognizeMaterialsInput): Promise<MaterialRecognitionResponse>
  subscribeToMaterials(craftId: string, next: (document: MaterialsDocument | null) => void, error: (error: GatewayError) => void): () => void
  editMaterials(input: EditMaterialsInput): Promise<void>
  confirmMaterials(input: ConfirmMaterialsInput): Promise<void>
}
// #13（作品候補の比較と選択）。制作可否・不足条件はサーバー（#33）の判定を正とし、画面で判定し直さない。
// 選んだ作品の確定と制作開始は#14のstartCraftで同時に行う。
export interface ProjectsGateway {
  generateProjects(input: GenerateProjectsInput): Promise<CandidatesDocument>
  translateProjects(input: TranslateProjectsInput): Promise<void>
  /** 検証済みの作品テンプレート（content/templates）。未登録なら空。 */
  listTemplates(): Promise<Template[]>
  /** crafts/{id}/workshop/candidates。未作成・無効化済みならnull。 */
  subscribeToCandidates(craftId: string, next: (document: CandidatesDocument | null) => void, error: (error: GatewayError) => void): () => void
}

export interface ExperienceGateway {
  startCraft(input: StartCraftInput): Promise<ProductionSnapshot>
  completeStep(input: CompleteStepInput): Promise<ProductionSnapshot>
  completeCraft(input: CompleteCraftInput): Promise<CompletionSnapshot>
  subscribeToProduction(craftId: string, next: (document: ProductionDocument | null) => void, error: (error: GatewayError) => void): () => void
  getCompletionPhoto(craftId: string): Promise<Blob | null>
  uploadCompletionPhoto(input: { craftId: string; photoId: string; blob: Blob }): Promise<{ photoPath: string }>
  listMyCrafts(): Promise<CraftHistoryItem[]>
  listGallery(): Promise<GalleryPost[]>
  getGalleryPost(postId: string): Promise<GalleryPost | null>
  listGalleryPage(input: ListGalleryPageInput): Promise<GalleryPage>
  publishCraft(input: PublishCraftInput): Promise<GalleryPost>
  galleryAction(input: GalleryActionInput): Promise<GalleryPost>
}
