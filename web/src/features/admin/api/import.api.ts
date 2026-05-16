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

export type ImportProgressUpdate = {
  phase: 'samples' | 'entity'
  completed: number
  total: number
  entityType?: string
}

type ImportFileEntry = ImportFolder['files'][number]

type ImportFunctionMode = 'dataset' | 'entity' | 'full'

export async function importDataset(input: {
  projectId: string
  folder: ImportFolder
  replace: boolean
  onProgress?: (progress: ImportProgressUpdate) => void
}): Promise<ImportResult> {
  return importDatasetStaged(input)
}

async function importDatasetStaged(input: {
  projectId: string
  folder: ImportFolder
  replace: boolean
  onProgress?: (progress: ImportProgressUpdate) => void
}): Promise<ImportResult> {
  const manifestFile = requiredFile(input.folder, 'manifest.json')
  const samplesFile = requiredFile(input.folder, 'samples.json')
  const totalEntities = input.folder.entities.length

  input.onProgress?.({ phase: 'samples', completed: 0, total: totalEntities })
  const bootstrap = await invokeImportFunction({
    mode: 'dataset',
    projectId: input.projectId,
    replace: false,
    files: [manifestFile, samplesFile],
  })

  const entities: ImportResult['entities'] = []
  const warnings = [...bootstrap.warnings]
  let result: ImportResult = {
    ...bootstrap,
    entities,
    warnings,
  }

  for (const [index, entity] of input.folder.entities.entries()) {
    input.onProgress?.({
      phase: 'entity',
      completed: index,
      total: totalEntities,
      entityType: entity.entity_type,
    })

    const auditFile = requiredFile(input.folder, 'entities/' + entity.entity_type + '/audit.json')
    const exportFile = requiredFile(input.folder, 'entities/' + entity.entity_type + '/export.json')
    const entityResult = await invokeImportFunction({
      mode: 'entity',
      projectId: input.projectId,
      replace: input.replace,
      files: [manifestFile, auditFile, exportFile],
    })

    entities.push(...entityResult.entities)
    warnings.push(...entityResult.warnings)
    result = {
      dataset_id: entityResult.dataset_id || result.dataset_id,
      dataset_created: result.dataset_created,
      sample_count: entityResult.sample_count || result.sample_count,
      entities: [...entities],
      warnings: [...warnings],
    }

    input.onProgress?.({
      phase: 'entity',
      completed: index + 1,
      total: totalEntities,
      entityType: entity.entity_type,
    })
  }

  return result
}

async function invokeImportFunction(input: {
  mode: ImportFunctionMode
  projectId: string
  replace: boolean
  files: ImportFileEntry[]
}): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('mode', input.mode)
  formData.append('projectId', input.projectId)
  formData.append('replace', String(input.replace))
  formData.append('paths', JSON.stringify(input.files.map((entry) => entry.path)))
  for (const entry of input.files) {
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

function requiredFile(folder: ImportFolder, path: string): ImportFileEntry {
  const entry = folder.files.find((file) => file.path === path)
  if (!entry) throw new Error('Missing ' + path + ' in selected import folder.')
  return entry
}

export function isSupabaseFunctionsConfigured(): boolean {
  return supabaseConfig.isConfigured
}

export type { Dataset }
