import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ManagementAuthGuard } from '../auth/management-auth.guard';
import { FunctionsService } from './functions.service';

@Controller('v1/functions')
@UseGuards(ManagementAuthGuard)
export class FunctionsController {
  constructor(private readonly functionsService: FunctionsService) {}

  @Get()
  list() {
    return this.functionsService.list();
  }

  @Get(':name')
  get(@Param('name') name: string) {
    return this.functionsService.get(name);
  }

  @Put(':name')
  apply(@Param('name') name: string, @Body() body: unknown) {
    return this.functionsService.apply(name, body);
  }

  @Post(':name/render')
  render(@Param('name') name: string, @Body() body: unknown) {
    return this.functionsService.render(name, body);
  }

  @Delete(':name')
  delete(@Param('name') name: string) {
    return this.functionsService.delete(name);
  }
}
