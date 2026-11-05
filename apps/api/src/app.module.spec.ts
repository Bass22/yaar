import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

// Spec: backlog A.1 — le workspace démarre, teste et compile en strict
describe("Module racine de l'API", () => {
  it('le module racine se charge sans erreur', async () => {
    // Given le module racine de l'application
    const testingModule = Test.createTestingModule({ imports: [AppModule] });

    // When NestJS le compile
    const moduleRef = await testingModule.compile();

    // Then il est disponible dans le conteneur
    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
    await moduleRef.close();
  });
});
