import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

// Spec: backlog A.1 — le workspace démarre, teste et compile en strict
describe("Coquille de l'application web", () => {
  it("la coquille se monte et réserve l'emplacement des écrans routés", async () => {
    // Given le composant racine et un routeur sans route
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();

    // When la coquille est rendue
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    // Then elle expose l'emplacement où s'afficheront les écrans routés
    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
  });
});
