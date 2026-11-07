import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/app-config';

// Spec: backlog A.1 — le workspace démarre, teste et compile en strict
describe("Module racine de l'API", () => {
  it('le module racine se charge sans erreur', async () => {
    // Given le module racine de l'application
    const testingModule = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: 'postgresql://nobody@127.0.0.1:1/none', jwtSecret: 'un-secret-de-test-assez-long-pour-signer-des-jetons' });

    // When NestJS le compile
    const moduleRef = await testingModule.compile();

    // Then il est disponible dans le conteneur
    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
    await moduleRef.close();
  });
});
