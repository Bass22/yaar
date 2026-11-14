import type { Route } from '@angular/router';
import { NotebookPage } from './notebook/notebook-page';

// The caretaker's notebook: a minimal bundle, part of the first files (Z.1). It never imports the
// admin's code nor @domain/finance.
export const caretakerRoutes: Route[] = [{ path: '', component: NotebookPage }];

export default caretakerRoutes;
