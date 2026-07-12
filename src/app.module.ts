import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FunctionsModule } from './functions/functions.module';

@Module({
  imports: [FunctionsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
