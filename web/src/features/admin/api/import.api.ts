import { supabase, supabaseConfig } from '@/lib/supabase/client'
import type {
  Dataset,
  ExistingDatasetCheck,
  ImportFolder,
  ImportResult,
  Json,
  LabelingProject,
} from '@/types/domain'

export async function listProjects(): Promise<LabelingProject[]> {
  const { data, error } = await supabase
    .from('labeling_projects')
    .select('*')
    .is('archived_at', null)
    .order('name', { ascending: true })

  if (error) throw error
  return data
}

export async function createProject(input: {
  slug: string
  name: string
  description?: string | null
}): Promise<LabelingProject> {
  const { data, error } = await supabase.rpc('create_project', {
    p_slug: input.slug,
    p_name: input.name,
    p_description: input.description ?? null,
  })

  if (error) throw error
  return data
}

export async function checkExistingDataset(
  projectId: string,
  folder: ImportFolder,
): Promise<ExistingDatasetCheck> {
  if (!folder.sourceKey || !folder.language) {
    return { dataset: null, existingEntityTypes: [] }
  }

  let query = supabase
    .from('datasets')
    .select('*')
    .eq('project_id', projectId)
    .eq('source_key', folder.sourceKey)
    .eq('language', folder.language)

  query = folder.folder ? query.eq('folder', folder.folder) : query.is('folder', null)

  const { data: dataset, error: datasetError } = await query.maybeSingle()
  if (datasetError) throw datasetError
  if (!dataset) return { dataset: null, existingEntityTypes: [] }

  const { data: rows, error: rowsError } = await supabase
    .from('review_items')
    .select('entity_type')
    .eq('dataset_id', dataset.id)

  if (rowsError) throw rowsError

  return {
    dataset,
    existingEntityTypes: Array.from(new Set(rows.map((row) => row.entity_type))).sort(),
  }
}

export async function importDataset(input: {
  projectId: string
  folder: ImportFolder
  replace: boolean
}): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('projectId', input.projectId)
  formData.append('replace', String(input.replace))
  formData.append('paths', JSON.stringify(input.folder.files.map((entry) => entry.path)))
  for (const entry of input.folder.files) {
    formData.append('files', entry.file, entry.path)
  }

  const { data, error } = await supabase.functions.invoke<{
    data: ImportResult
    preview?: Json
  }>('import-dataset', {
    body: formData,
  })

  if (error) throw error
  if (!data?.data) throw new Error('Import function returned no result.')
  return data.data
}

export function isSupabaseFunctionsConfigured(): boolean {
  return supabaseConfig.isConfigured
}

export type { Dataset }
