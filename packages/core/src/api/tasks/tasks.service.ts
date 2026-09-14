import type {
    RepositoryRegistry,
    TransactionRunner,
} from '../../repositories.ts'

export function createTaskService(
    repositories: RepositoryRegistry,
    transaction?: TransactionRunner,
) {
    return {}
}
