import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PagePermissionMemberDto {
  @IsUUID()
  id: string;

  @IsIn(['user', 'group'])
  type: 'user' | 'group';

  @IsIn(['reader', 'writer'])
  role: 'reader' | 'writer';
}

export class SetPagePermissionsDto {
  @IsNotEmpty()
  @IsUUID()
  pageId: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PagePermissionMemberDto)
  members: PagePermissionMemberDto[];
}

export class ClearPagePermissionsDto {
  @IsNotEmpty()
  @IsUUID()
  pageId: string;
}
